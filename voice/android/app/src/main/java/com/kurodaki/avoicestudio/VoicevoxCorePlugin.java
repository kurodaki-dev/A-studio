package com.kurodaki.avoicestudio;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.gson.Gson;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;
import jp.hiroshiba.voicevoxcore.CharacterMeta;
import jp.hiroshiba.voicevoxcore.FrameAudioQuery;
import jp.hiroshiba.voicevoxcore.Score;
import jp.hiroshiba.voicevoxcore.StyleMeta;
import jp.hiroshiba.voicevoxcore.blocking.OpenJtalk;
import jp.hiroshiba.voicevoxcore.blocking.Onnxruntime;
import jp.hiroshiba.voicevoxcore.blocking.Synthesizer;
import jp.hiroshiba.voicevoxcore.blocking.VoiceModelFile;

/**
 * VOICEVOX CORE inside the app: singing voices without any engine to run. The singing
 * voices (s0.vvm) and the Open JTalk dictionary are downloaded once from their official
 * GitHub releases (the addresses are fixed here: the page cannot ask for another one);
 * the VOICEVOX build of ONNX Runtime (needed by the protected voice models) and the
 * VOICEVOX CORE library are packaged in the APK.
 */
@CapacitorPlugin(name = "VoicevoxCore")
public class VoicevoxCorePlugin extends Plugin {

    private static final String MODEL_URL = "https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.17.0/s0.vvm";
    private static final long MODEL_SIZE = 130412376L;
    private static final String DICT_URL = "https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz";
    private static final String DICT_DIR = "open_jtalk_dic_utf_8-1.11";
    private static final int MAX_QUERIES = 8;

    private final Object lock = new Object();
    // One job at a time: the models are big, and the singing voices share them.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, FrameAudioQuery> queries = new LinkedHashMap<>();
    private Synthesizer synthesizer;
    private VoiceModelFile model;

    private File root() {
        File d = new File(getContext().getFilesDir(), "voicevox");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private File modelFile() {
        return new File(root(), "s0.vvm");
    }

    private File dictDir() {
        return new File(root(), DICT_DIR);
    }

    private boolean modelReady() {
        File f = modelFile();
        return f.isFile() && f.length() == MODEL_SIZE;
    }

    private boolean dictReady() {
        return new File(dictDir(), "sys.dic").isFile();
    }

    /** True when the native libraries of this phone's CPU load (arm64). */
    private boolean runtimeAvailable() {
        try {
            Class.forName("jp.hiroshiba.voicevoxcore.blocking.Onnxruntime");
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("runtime", runtimeAvailable());
        ret.put("model", modelReady());
        ret.put("dict", dictReady());
        call.resolve(ret);
    }

    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            try {
                if (!modelReady()) {
                    File part = new File(root(), "s0.vvm.part");
                    download(MODEL_URL, part, "voices");
                    if (part.length() != MODEL_SIZE) throw new IOException("Incomplete download of the voices");
                    File f = modelFile();
                    if (f.exists()) f.delete();
                    if (!part.renameTo(f)) throw new IOException("Cannot save the voices");
                }
                if (!dictReady()) {
                    File gz = new File(root(), "dict.tar.gz.part");
                    download(DICT_URL, gz, "dictionary");
                    File tmp = new File(root(), "dict.tmp");
                    deleteTree(tmp);
                    untarGz(gz, tmp);
                    File extracted = new File(tmp, DICT_DIR);
                    if (!new File(extracted, "sys.dic").isFile()) throw new IOException("Invalid dictionary");
                    deleteTree(dictDir());
                    if (!extracted.renameTo(dictDir())) throw new IOException("Cannot save the dictionary");
                    deleteTree(tmp);
                    gz.delete();
                }
                call.resolve();
            } catch (Throwable t) {
                call.reject(message(t));
            }
        });
    }

    @PluginMethod
    public void singers(PluginCall call) {
        worker.execute(() -> {
            try {
                ensureReady();
                JSArray list = new JSArray();
                for (CharacterMeta c : model.metas) {
                    JSObject o = new JSObject();
                    o.put("name", c.name);
                    o.put("uuid", c.speakerUuid);
                    JSArray styles = new JSArray();
                    for (StyleMeta s : c.styles) {
                        JSObject so = new JSObject();
                        so.put("name", s.name);
                        so.put("id", s.id);
                        so.put("type", s.type.toString());
                        styles.put(so);
                    }
                    o.put("styles", styles);
                    list.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("singers", list);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject(message(t));
            }
        });
    }

    /** The teacher's timing, pitch and volume for a score (JSON {notes: [{key, frame_length, lyric}]}). */
    @PluginMethod
    public void query(PluginCall call) {
        final String scoreJson = call.getString("score");
        final Integer style = call.getInt("style", 6000);
        worker.execute(() -> {
            try {
                if (scoreJson == null) throw new IllegalArgumentException("score");
                ensureReady();
                Score score = new Gson().fromJson(scoreJson, Score.class);
                FrameAudioQuery q;
                synchronized (lock) {
                    q = synthesizer.createSingFrameAudioQuery(score, style);
                }
                String token = UUID.randomUUID().toString();
                synchronized (lock) {
                    queries.put(token, q);
                    while (queries.size() > MAX_QUERIES) {
                        String oldest = queries.keySet().iterator().next();
                        queries.remove(oldest);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("token", token);
                ret.put("f0", floats(q.f0));
                ret.put("volume", floats(q.volume));
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject(message(t));
            }
        });
    }

    /** Audio (WAV, base64) of a query with the pitch and volume sent by the page. */
    @PluginMethod
    public void synthesize(PluginCall call) {
        final String token = call.getString("token");
        final Integer style = call.getInt("style");
        final JSArray f0 = call.getArray("f0");
        final JSArray volume = call.getArray("volume");
        worker.execute(() -> {
            try {
                if (token == null || style == null || f0 == null || volume == null) throw new IllegalArgumentException("synthesize");
                ensureReady();
                FrameAudioQuery q;
                synchronized (lock) {
                    q = queries.get(token);
                }
                if (q == null) throw new IllegalStateException("The query expired, render again");
                if (f0.length() != q.f0.length || volume.length() != q.volume.length) throw new IllegalArgumentException("Wrong curve length");
                float[] nf0 = new float[q.f0.length];
                float[] nvol = new float[q.volume.length];
                for (int i = 0; i < nf0.length; i++) nf0[i] = (float) f0.getDouble(i);
                for (int i = 0; i < nvol.length; i++) nvol[i] = (float) volume.getDouble(i);
                FrameAudioQuery own = new FrameAudioQuery(nf0, nvol, q.phonemes, q.volumeScale, q.outputSamplingRate, q.outputStereo);
                byte[] wav;
                synchronized (lock) {
                    wav = synthesizer.frameSynthesis(own, style);
                }
                JSObject ret = new JSObject();
                ret.put("wav", Base64.encodeToString(wav, Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject(message(t));
            }
        });
    }

    private static JSArray floats(float[] a) {
        JSArray out = new JSArray();
        for (float v : a) {
            try {
                out.put((double) v);
            } catch (Exception e) {
                out.put(0);
            }
        }
        return out;
    }

    private static String message(Throwable t) {
        String m = t.getMessage();
        return m == null || m.isEmpty() ? t.getClass().getSimpleName() : m;
    }

    /** Loads the runtime, the dictionary and the voices on first use. */
    private void ensureReady() throws Exception {
        synchronized (lock) {
            if (synthesizer != null) return;
            if (!modelReady() || !dictReady()) throw new IllegalStateException("The VOICEVOX voices are not downloaded yet");
            Onnxruntime ort = Onnxruntime.loadOnce().filename(Onnxruntime.LIB_RECOMMENDED_UNVERSIONED_FILENAME).perform();
            OpenJtalk jtalk = new OpenJtalk(dictDir().getAbsolutePath());
            int threads = Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors()));
            Synthesizer s = Synthesizer.builder(ort, jtalk).cpuNumThreads(threads).build();
            VoiceModelFile m = new VoiceModelFile(modelFile().getAbsolutePath());
            s.loadVoiceModel(m).perform();
            model = m;
            synthesizer = s;
        }
    }

    // ---- download and extraction ----

    private void progress(String what, long received, long total) {
        JSObject p = new JSObject();
        p.put("what", what);
        p.put("received", received);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    /** Downloads one of the two fixed official addresses, following GitHub's redirects (HTTPS only). */
    private void download(String url, File out, String what) throws IOException {
        if (!MODEL_URL.equals(url) && !DICT_URL.equals(url)) throw new IOException("URL not allowed");
        HttpURLConnection conn = null;
        try {
            URL current = new URL(url);
            for (int i = 0; i < 6; i++) {
                conn = (HttpURLConnection) current.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (loc == null) throw new IOException("Redirect without location");
                    current = new URL(current, loc);
                    if (!"https".equals(current.getProtocol())) throw new IOException("Insecure redirect");
                    continue;
                }
                if (code != 200) throw new IOException("HTTP " + code);
                break;
            }
            if (conn == null) throw new IOException("Too many redirects");
            long total = conn.getContentLengthLong();
            long received = 0;
            long lastSent = 0;
            try (InputStream in = conn.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) {
                    os.write(buf, 0, n);
                    received += n;
                    if (received - lastSent > 524288 || received == total) {
                        lastSent = received;
                        progress(what, received, total);
                    }
                }
            }
            if (total > 0 && received != total) throw new IOException("Download interrupted");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    private static String cString(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && b[end] != 0) end++;
        return new String(b, off, end - off, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static boolean readFully(InputStream in, byte[] buf, int len) throws IOException {
        int got = 0;
        while (got < len) {
            int n = in.read(buf, got, len - got);
            if (n < 0) return got != 0 && got == len;
            got += n;
        }
        return true;
    }

    /** Extracts a .tar.gz (ustar / GNU long names) into a folder; paths cannot leave it. */
    private static void untarGz(File gz, File outDir) throws IOException {
        outDir.mkdirs();
        String canonicalRoot = outDir.getCanonicalPath() + File.separator;
        try (InputStream in = new BufferedInputStream(new GZIPInputStream(new BufferedInputStream(new java.io.FileInputStream(gz), 65536)), 65536)) {
            byte[] h = new byte[512];
            String longName = null;
            while (readFully(in, h, 512)) {
                boolean empty = true;
                for (int i = 0; i < 512; i++) {
                    if (h[i] != 0) {
                        empty = false;
                        break;
                    }
                }
                if (empty) break;
                String name = cString(h, 0, 100);
                String prefix = cString(h, 345, 155);
                if (!prefix.isEmpty()) name = prefix + "/" + name;
                long size = Long.parseLong(cString(h, 124, 12).trim().isEmpty() ? "0" : cString(h, 124, 12).trim(), 8);
                char type = (char) (h[156] == 0 ? '0' : h[156]);
                long padded = ((size + 511) / 512) * 512;
                if (type == 'L') {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    copy(in, bo, size);
                    skip(in, padded - size);
                    longName = cString(bo.toByteArray(), 0, (int) size);
                    continue;
                }
                if (type == 'x' || type == 'g') {
                    skip(in, padded);
                    continue;
                }
                if (longName != null) {
                    name = longName;
                    longName = null;
                }
                File target = new File(outDir, name);
                if (!target.getCanonicalPath().startsWith(canonicalRoot) && !target.getCanonicalPath().equals(outDir.getCanonicalPath())) {
                    throw new IOException("Unsafe path in archive: " + name);
                }
                if (type == '5') {
                    target.mkdirs();
                    skip(in, padded);
                } else if (type == '0') {
                    File parent = target.getParentFile();
                    if (parent != null) parent.mkdirs();
                    try (OutputStream os = new FileOutputStream(target)) {
                        copy(in, os, size);
                    }
                    skip(in, padded - size);
                } else {
                    skip(in, padded);
                }
            }
        }
    }

    private static void copy(InputStream in, OutputStream out, long size) throws IOException {
        byte[] buf = new byte[65536];
        long left = size;
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) throw new IOException("Unexpected end of archive");
            out.write(buf, 0, n);
            left -= n;
        }
    }

    private static void skip(InputStream in, long n) throws IOException {
        long left = n;
        byte[] buf = new byte[4096];
        while (left > 0) {
            int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r < 0) throw new IOException("Unexpected end of archive");
            left -= r;
        }
    }
}
