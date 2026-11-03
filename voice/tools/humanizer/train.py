# Trains the A Voice Studio humanizer: a small 1D convolutional network that turns a
# flat note pitch curve (what UTAU concatenation gives) into a sung pitch curve.
# Data: pitch curves of real singers (M4Singer, CC BY-NC-SA 4.0), 100 frames/s, MIDI.
# Self-supervised: the flat input is rebuilt from each real curve (notes = stable
# segments rounded to semitones, 80 ms glides, rests held), the target is the real curve.
import json, sys, math, random
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(0)
np.random.seed(0)
random.seed(0)
base = sys.argv[1]
out_onnx = sys.argv[2]
idx = json.load(open(base + '.json'))
allf = np.fromfile(base + '.f32', dtype=np.float32)


def medfilt(x, k):
    pad = k // 2
    xp = np.pad(x, pad, mode='edge')
    return np.array([np.median(xp[i:i + k]) for i in range(len(x))], dtype=np.float32)


def clean(f):
    """Voiced mask, octave-error cleanup and short gap filling."""
    v = f > 0
    if v.sum() < 50:
        return None, None
    g = f.copy()
    # Octave jumps: a frame far from its local median is an error.
    med = medfilt(np.where(v, g, 0), 9)
    bad = v & (np.abs(g - med) > 4) & (med > 0)
    v = v & ~bad
    g[~v] = 0
    # Fill unvoiced gaps shorter than 60 ms by interpolation (consonants).
    i = 0
    n = len(g)
    while i < n:
        if not v[i]:
            j = i
            while j < n and not v[j]:
                j += 1
            if 0 < i and j < n and j - i <= 6:
                g[i:j] = np.linspace(g[i - 1], g[j], j - i + 2)[1:-1]
                v[i:j] = True
            i = j
        else:
            i += 1
    return g, v


def notes_of(g, v):
    """Flat note curve: stable segments of the smoothed pitch rounded to semitones."""
    sm = medfilt(np.where(v, g, 0), 15)
    q = np.where(v, np.round(sm), 0)
    # Merge segments shorter than 80 ms into the previous one.
    n = len(q)
    seg = []
    i = 0
    while i < n:
        j = i
        while j < n and q[j] == q[i]:
            j += 1
        seg.append([i, j, q[i]])
        i = j
    for k in range(1, len(seg)):
        a = seg[k]
        if a[2] != 0 and a[1] - a[0] < 8 and seg[k - 1][2] != 0:
            a[2] = seg[k - 1][2]
    flat = np.zeros(n, dtype=np.float32)
    for a, b, val in seg:
        flat[a:b] = val
    # Each note takes the median of the real pitch on it, rounded (singers detune).
    i = 0
    while i < n:
        j = i
        while j < n and flat[j] == flat[i]:
            j += 1
        if flat[i] != 0:
            flat[i:j] = np.round(np.median(g[i:j][v[i:j]])) if v[i:j].any() else flat[i]
        i = j
    # Rests hold the note before (like the app's pitch curve).
    last = flat[np.argmax(flat > 0)] if (flat > 0).any() else 60
    for i in range(n):
        if flat[i] == 0:
            flat[i] = last
        else:
            last = flat[i]
    # 80 ms raised-cosine glides at note changes, ending on the note start.
    out = flat.copy()
    for i in range(1, n):
        if flat[i] != flat[i - 1]:
            a = max(0, i - 8)
            for t in range(a, i):
                x = (t - a + 1) / (i - a + 1)
                out[t] = flat[i - 1] + (flat[i] - flat[i - 1]) * (0.5 - 0.5 * math.cos(math.pi * x))
    return out


pairs = []
for it in idx:
    f = allf[it['start']:it['start'] + it['len']]
    g, v = clean(f)
    if g is None:
        continue
    x = notes_of(g, v)
    y = np.where(v, g, x)  # unvoiced frames: no target (masked)
    pairs.append((it['singer'], x.astype(np.float32), y.astype(np.float32), v.astype(np.float32)))
singers = sorted(set(p[0] for p in pairs))
val_singers = {'Alto-7', 'Tenor-7', 'Bass-3'}
train = [p for p in pairs if p[0] not in val_singers]
val = [p for p in pairs if p[0] in val_singers]
print(len(pairs), 'clips,', len(singers), 'singers; train', len(train), 'val', len(val))


class Humanizer(nn.Module):
    """Input f0 [1, T] (MIDI). Works on the curve minus its 1 s average, so the
    output does not depend on the key. Output: the humanized f0 [1, T]."""

    def __init__(self, ch=32):
        super().__init__()
        self.avg = nn.AvgPool1d(101, stride=1, padding=50, count_include_pad=False)
        self.inp = nn.Conv1d(1, ch, 5, padding=2)
        self.blocks = nn.ModuleList([nn.Conv1d(ch, ch, 5, padding=2 * d, dilation=d) for d in (1, 2, 4, 8, 16)])
        self.out = nn.Conv1d(ch, 1, 1)

    def forward(self, f0):
        x = f0.unsqueeze(1)
        rel = x - self.avg(x)
        h = torch.tanh(self.inp(rel))
        for b in self.blocks:
            h = h + torch.tanh(b(h))
        dev = 1.5 * torch.tanh(self.out(h))  # at most 1.5 semitones
        return (x + dev).squeeze(1)


def batches(data, n=24, T=400):
    while True:
        b = random.sample(data, n)
        xs, ys, ms = [], [], []
        for _, x, y, m in b:
            if len(x) <= T:
                pad = T - len(x)
                xs.append(np.pad(x, (0, pad), mode='edge'))
                ys.append(np.pad(y, (0, pad), mode='edge'))
                ms.append(np.pad(m, (0, pad)))
            else:
                s = random.randint(0, len(x) - T)
                xs.append(x[s:s + T]); ys.append(y[s:s + T]); ms.append(m[s:s + T])
        # Random key shift: the model must not depend on the key.
        k = np.random.randint(-6, 7, size=(n, 1)).astype(np.float32)
        yield torch.tensor(np.stack(xs) + k), torch.tensor(np.stack(ys) + k), torch.tensor(np.stack(ms))


def evaluate(model, data):
    model.eval()
    e_flat = e_mod = cnt = 0.0
    tr_flat = tr_mod = tr_cnt = 0.0
    with torch.no_grad():
        for _, x, y, m in data:
            o = model(torch.tensor(x)[None])[0].numpy()
            e_flat += float(np.sum(np.abs(x - y) * m)); e_mod += float(np.sum(np.abs(o - y) * m)); cnt += float(m.sum())
            # Around note changes (+-150 ms): where the humanizer matters most.
            ch = np.zeros_like(m)
            for i in np.nonzero(np.diff(np.round(x)) != 0)[0]:
                ch[max(0, i - 15):i + 15] = 1
            mm = m * ch
            tr_flat += float(np.sum(np.abs(x - y) * mm)); tr_mod += float(np.sum(np.abs(o - y) * mm)); tr_cnt += float(mm.sum())
    model.train()
    return e_flat / cnt, e_mod / cnt, tr_flat / max(1, tr_cnt), tr_mod / max(1, tr_cnt)


model = Humanizer()
print('parameters', sum(p.numel() for p in model.parameters()))
opt = torch.optim.Adam(model.parameters(), lr=2e-3)
gen = batches(train)
steps = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
for step in range(steps + 1):
    x, y, m = next(gen)
    o = model(x)
    loss = (torch.abs(o - y) * m).sum() / m.sum()
    opt.zero_grad(); loss.backward(); opt.step()
    if step == int(steps * 0.7):
        for g in opt.param_groups: g['lr'] = 5e-4
    if step % 500 == 0:
        ef, em, tf, tm = evaluate(model, val)
        print(f'step {step} loss {loss.item():.4f} | val error (semitones) flat {ef:.4f} model {em:.4f} | near note changes flat {tf:.4f} model {tm:.4f}')

ef, em, tf, tm = evaluate(model, val)
json.dump({'val_flat': ef, 'val_model': em, 'val_trans_flat': tf, 'val_trans_model': tm, 'train_clips': len(train), 'val_clips': len(val), 'val_singers': sorted(val_singers)}, open(out_onnx + '.json', 'w'))
model.eval()
dummy = torch.full((1, 300), 60.0)
torch.onnx.export(model, (dummy,), out_onnx, input_names=['f0'], output_names=['f0_out'], dynamic_axes={'f0': {1: 'T'}, 'f0_out': {1: 'T'}}, opset_version=13, dynamo=False)
print('exported', out_onnx)
