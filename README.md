<div align="center">

<img src="public/icon.svg" width="128" height="128" alt="A Studio icon">

# A Studio for Android

**A Studio is an open source music production studio for Android, built on the FL Studio workflow.**<br>
Channel rack, piano roll, playlist, mixer and a browser for your own samples, in your pocket.

<a href="https://github.com/kurodaki-dev/A-studio/releases/latest/download/A-Studio.apk"><img src="https://img.shields.io/github/v/release/kurodaki-dev/A-studio?style=for-the-badge&label=Download%20APK&logo=android&logoColor=white&color=2f383d" alt="Download the APK"></a>
<a href="https://kurodaki-dev.github.io/A-studio/"><img src="https://img.shields.io/badge/Try%20it-in%20the%20browser-2f383d?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Try it in the browser"></a>
<a href="https://kurodaki-dev.github.io/A-studio/doc/"><img src="https://img.shields.io/badge/Read%20the-docs-2f383d?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation"></a>

<img src="https://img.shields.io/badge/engine-Web%20Audio-f0993a" alt="engine Web Audio">
<img src="https://img.shields.io/badge/UI-JavaScript%20·%20Capacitor-0a7bbb" alt="UI JavaScript and Capacitor">
<img src="https://img.shields.io/badge/min-Android%207%20(API%2024)-0a7bbb" alt="min Android 7">
<img src="https://img.shields.io/badge/target-Android%2016%20(API%2036)-0a7bbb" alt="target Android 16">
<img src="https://img.shields.io/badge/license-MIT-0a7bbb" alt="license MIT">
<img src="https://img.shields.io/badge/status-beta-8e9ba1" alt="status beta">

[Screenshots](#screenshots) · [Features](#features) · [Piano roll](#piano-roll) · [Browser and samples](#browser-and-samples) · [Plugins and themes](#plugins-and-themes) · [Vocals](#features) · [AI (MCP)](#ai-assistant-mcp) · [Updates](#updates) · [Privacy](#privacy) · [Building](#building)

</div>

## Screenshots

<p align="center">
  <img src="docs/screenshots/channel-rack.png" width="49%" alt="Channel rack with a drum pattern">
  <img src="docs/screenshots/piano-roll.png" width="49%" alt="Piano roll with chords">
</p>
<p align="center">
  <img src="docs/screenshots/playlist-browser.png" width="49%" alt="Playlist with the browser panel open">
  <img src="docs/screenshots/mixer.png" width="49%" alt="Mixer with the master and inserts">
</p>
<p align="center">
  <img src="docs/screenshots/settings.png" width="49%" alt="Settings with themes and plugins">
</p>
<p align="center"><sub>Channel rack, piano roll, playlist with the browser, mixer and settings, captured from the app in landscape.</sub></p>

## Features

- **Channel settings** (double tap a channel): volume, filter and pitch envelopes, LFO (tremolo, vibrato, wobble, tempo synced), arpeggiator, mono and portamento, test keyboard.
- **Channel rack**: 16 steps per bar in FL Studio style groups, drag to fill or clear steps, per channel enable, pan, volume and mixer insert, swing per pattern, step velocity editing, solo, fill each 2, 4 or 8 steps, random steps, shift left or right, channel colors and groups with a filter.
- **Piano roll**: draw, paint, delete, select, slice and pan tools, snap from 1/6 step to a bar, ghost notes, velocity lane, playable keyboard, copy, paste, duplicate, transpose and quantize, live recording from the keyboard or a USB MIDI keyboard, slide notes (808 glides), scale highlighting (11 scales), and tools: chords, arpeggiate, strum, humanize, legato, reverse, flip, double or half length, snap to scale.
- **Playlist**: PAT and SONG modes, 16 tracks, pattern, audio and automation clips, stretch, select, copy, paste, duplicate and split clips, loop region, markers with tempo changes, audio clip gain, pitch and fades.
- **Automation**: clips that move a channel or mixer parameter over the song (volume, pan, filter, sends, EQ), with a curve editor and LFO shapes.
- **Vocals**: auto tune (key and scale or the MIDI notes of a channel, hard or natural, flex tune, natural vibrato kept or added, formant control, low latency mode, live pitch graph, no warble between notes), voice changer, harmonizer, noise gate, de-esser, doubler, reverb, tempo synced echo and robot voice; ready vocal chains (trap, R&B, rap, ad libs, radio, deep voice) on a one tap vocal insert, your own saved chains, live monitoring with the effects, lyrics on screen, loop recording into takes and a tuner.
- **Recording**: microphone takes straight into the playlist, notes from the piano roll keyboard or a MIDI keyboard, one bar count in.
- **Mixer**: master and 16 inserts with fader, pan, reverb and delay sends, three band EQ, mute, solo, level meters, routing to buses and 4 effect slots each, with built in compressor, limiter, filter, distortion and sidechain.
- **Browser**: FL Studio style side panel with your projects, imported samples, plugins and 23 built in instruments.
- **Sounds**: drums (kick, snare, clap, hats, crash, tom, rimshot, cowbell), piano, electric piano, organ, synth and 808 bass, lead, pad, pluck, strings, guitar, flute, brass, marimba and bell, all synthesized in real time. Plus a Sampler for your own samples (start and end points, loop, reverse), a slicer that chops loops into playable slices, and multi sample instruments built from a folder of samples named after their notes. Every channel has an ADSR envelope.
- **Projects**: templates (hip hop, trap, house), autosave, saved projects, `.astudio` import and export, MIDI import, export of a pattern or the whole song as WAV 16 or 24 bit, MP3, MIDI or stems (ZIP of one WAV per channel) with optional normalization, time signatures from 2/4 to 7/4, project info with author and notes, undo and redo.
- **Audio editing**: waveform editor (cut, trim, silence, gain, fades, reverse, normalize), clean up tools with preview (noise reduction, click and pop removal, clipping repair, hum, rumble, DC, breaths, spectrum view, -14 LUFS, vocal removal or isolation, one tap voice clean up), BPM detection, time stretch that keeps the pitch, render a pattern to audio, comping.
- **Mastering**: mastering chains, live spectrum, loudness in LUFS (BS.1770) with streaming targets.
- **Live mode**: pattern pads launched in time on the next bar, recordable to the playlist.
- **Synth**: 3x Osc with three oscillators, noise, envelope, filter and presets.
- **More**: recording latency calibration, formant preserving pitch shift (PSOLA), effect parameter automation, MIDI learn, project export with samples (ZIP), automatic backups, a getting started guide and a portrait layout.
- **Tempo**: drag, type or tap tempo, tempo changes from markers, metronome, voice and CPU meter.
- **Settings**: English or French interface, themes, code plugins, update check.
- FL Studio style menu bar (FILE, EDIT, ADD, PATTERNS, VIEW, OPTIONS, TOOLS, HELP), shown or hidden with the three lines button.
- Scrollbars and two finger gestures for navigation, landscape full screen layout, keyboard shortcuts on tablets (press `?` to list them).

## Piano roll

The piano roll follows FL Studio: tap to place a note with the last used length, tap a note to reuse its length and velocity, drag to move, drag the right edge to resize, long press (or right click) to delete. Middle C is named `C5`, as in FL Studio. See the [documentation](https://kurodaki-dev.github.io/A-studio/doc/#piano-roll) for every tool.

## Browser and samples

Import audio files (WAV, MP3, OGG, FLAC, M4A, AIFF) or whole ZIP sample packs from the browser. Folders inside a pack are kept and everything stays on the device. Drag an item to the right (or long press it) and drop it:

- on a playlist track to make an audio clip,
- in the piano roll to create a Sampler channel and place a note,
- in the channel rack to create a Sampler channel.

## Plugins and themes

Install them from **Menu, Plugins and themes**: browse the **catalog** and install in one tap, pick a file, or paste a **GitHub link** (repository, folder or file) and the app finds the plugins and themes in it. Plugins installed from GitHub can be updated with one tap.

- **Plugins** are JavaScript files. **Instruments** compute their own samples for every note; **effects** process a mixer insert (4 FX slots per insert). Controls are declared in the header (knobs, switches, choice lists, buttons) with factory presets, and you can save your own presets. Instruments and effects get the tempo for synced sounds. Write, test and export plugins on the phone with the built in editor: templates, a `dsp` helper library (band limited oscillators, envelopes, filters, delays, noise), errors shown with their line number, a test keyboard for instruments and a test beat for effects. The code runs isolated in the audio thread (AudioWorklet), without access to the interface, storage, files or network; a crashing voice or effect is contained without taking the app down.
- **Extensions** change the interface itself: add buttons to the top bar (a Play button, for example), menu items and whole panels with your own HTML interface, drive playback, read and write notes, play sounds, keep their own data and add keyboard shortcuts. They run in an isolated frame and can only use the permissions declared in their header.
- **Themes** are JSON files that change the interface and editor colors, with hex values only.

The plugin API, the theme format and ready to install examples (AI Connect, Chord Helper, Beat Tools, Poly Synth, Stereo Delay, Bitcrusher, Supersaw, FM Bell, Noise Snare) are in the [documentation](https://kurodaki-dev.github.io/A-studio/doc/#plugins).

## A Voice Studio (vocal extension)

**A Voice Studio** is a separate extension for singing voices, in the spirit of Vocaloid and OpenUtau, with its own interface, browser, themes and plugins. Open it with the **A Studio | A Voice Studio** switch above the menu bar.

- **Voices**: DiffSinger banks (OpenUtau layout: `dsconfig.yaml`, phonemes, ONNX acoustic model, NSF-HiFiGAN vocoder in `dsvocoder/` or imported as an `.oudep`), run on the device with ONNX Runtime; UTAU / OpenUTAU banks (`oto.ini`, CV and VCV, `prefix.map`, Shift-JIS) rendered with PSOLA; VOICEVOX singing through a VOICEVOX engine (address of a computer running it); three built-in vocoder voices that work without any download.
- **Lyrics**: type letters (romaji); they become kana and phonemes automatically. A whole phrase can be typed at once, one syllable per note.
- **Editing**: vocal piano roll with the sung pitch curve, pitch pencil, curves for dynamics, pitch bend, breathiness, gender and tension, vibrato and portamento per note, several tracks.
- **Humanizer** for UTAU voices (off by default): a light built-in one, or a local ONNX model you import (input `f0` [1, T] in MIDI notes at 100 frames per second, output the humanized pitch).
- **Files**: `.avsp` projects, UTAU `.ust` and MIDI import, WAV export, and **Send to A Studio** (straight into the A Studio sample library on the web, a saved and shared WAV on Android).

On Android it is a second APK, `A-Voice-Studio.apk`, published in every release next to `A-Studio.apk`. It has no icon in the app drawer: A Studio opens it from the switch, and offers to download it the first time. On the web it is published in `voice/` next to A Studio.

## AI assistant (MCP)

An AI assistant such as Claude can work in A Studio: read the project, write notes, add channels, set the tempo and play. Run the [`astudio-mcp`](mcp-server/README.md) bridge on your computer and add it to your AI app (Claude Desktop, Claude Code, Cursor...), then install the **AI Connect (MCP)** plugin from the catalog: it adds an **AI connection (MCP)** section in Settings where you enter the bridge address and pairing code.

## Updates

Every push to `main` builds a signed APK and publishes a release `v1.0.<n>`, where n is the previous release plus one. At startup the app checks the latest release; when you tap Download it fetches the APK and opens the Android installer, which asks you to confirm. Tap Open at the end to restart on the new version. Your projects are kept. The startup check can be turned off in Settings.

## Privacy

A Studio collects no personal data: no account, no ads, no analytics. Projects, samples, microphone recordings, plugins and themes stay on the device; the microphone is only used when you choose to record audio. The only connection asks GitHub for the latest release. See the [privacy policy](https://kurodaki-dev.github.io/A-studio/legal/privacy.html), [terms of use](https://kurodaki-dev.github.io/A-studio/legal/terms.html) and [cookie policy](https://kurodaki-dev.github.io/A-studio/legal/cookies.html). No cookie banner is needed: the app sets no cookies and only uses strictly necessary local storage.

## Building

Requirements: Node.js 22, JDK 21, Android SDK (platform 36).

```bash
npm install
npm run dev          # web version on http://localhost:5173
npm test             # unit tests
npm run build        # builds dist/
npx cap sync android # copies dist/ into the Android project
cd android && ./gradlew assembleDebug

# A Voice Studio (the vocal extension)
npm run build:voice              # builds voice/dist/
cd voice && npx cap sync android # copies it into voice/android
cd android && ./gradlew assembleDebug
```

### Releases

- `.github/workflows/android.yml` builds the signed APKs (A Studio and the A Voice Studio extension) on every push to `main` and publishes a release (the previous version plus one, so pull request builds do not skip numbers). Pull requests build a test APK only.
- `.github/workflows/pages.yml` publishes the web version, the documentation (`/doc`) and the legal pages on GitHub Pages.

Android only installs an update signed with the same key as the installed app. The key is never committed; the workflow reads it from two repository secrets:

| Secret | Content |
|---|---|
| `ANDROID_KEYSTORE` | The `.jks` file encoded in base64 (`base64 -w0 astudio.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | Password of the file and of the key (alias `astudio`) |

### Project structure

```
src/
  audio/        instrument catalog, synthesized instruments, engine (sequencer, mixer, export)
  ui/           channel rack, piano roll, playlist, mixer, browser, settings, controls
  locales/      translations (English is the source language)
  plugins.js    code plugins: header parsing and the AudioWorklet host
  extensions.js interface extensions: sandboxed frames and the astudio API
  themes.js     themes
  samples.js    sample storage (IndexedDB) and ZIP import
public/
  doc/          documentation site and plugin and theme examples
  legal/        privacy, terms and cookie pages (English, French in legal/fr)
android/        Capacitor project, including the in app updater
mcp-server/     astudio-mcp, the MCP bridge for AI assistants
voice/          A Voice Studio, the vocal extension (its own page, code, themes and plugins)
  src/voices/   engines: built-in vocoder, UTAU, DiffSinger (ONNX), VOICEVOX, humanizer
  android/      Capacitor project of the extension APK (com.kurodaki.avoicestudio)
```

## Contributing

Bug reports and ideas are welcome: [open an issue](https://github.com/kurodaki-dev/A-studio/issues/new/choose). The app menu has **Report a bug** (the form opens with your version filled in) and **Request a feature**.

## License

MIT. Icons: [Lucide](https://lucide.dev), the icon set used by shadcn/ui (ISC license). MP3 export uses [lamejs](https://github.com/zhuker/lamejs) (LAME, LGPL 3.0), shipped as a separate file loaded only for MP3 export.

A Studio is an independent project, not affiliated with Image Line Software. FL Studio is a trademark of Image Line Software.
