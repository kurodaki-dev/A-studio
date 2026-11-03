# Built-in humanizer model

`humanizer.onnx` (about 100 KB, 26 k parameters) is the AI humanizer of A Voice Studio for UTAU voices.
It is a small 1D convolutional network: input `f0` [1, T], the flat pitch of the notes in MIDI
notes at 100 frames per second; output `f0_out` [1, T], the pitch as a singer would sing it
(glides, overshoots, preparations). It works on the curve minus its 1 second average, so it does
not depend on the key, and it moves the pitch by at most 1.5 semitones.

Training data: pitch curves of real singers from the M4Singer corpus (CC BY-NC-SA 4.0), extracted
with the YIN tracker of the app. The flat input is rebuilt from each real curve (stable segments
rounded to semitones, 80 ms glides, rests held) and the network learns to give back the real curve.
The model is therefore under CC BY-NC-SA 4.0 too (non commercial use, same licence).

Result on 3 singers left out of the training (Alto-7, Bass-3, Tenor-7, 105 clips): mean distance to
the real sung pitch 0.457 semitones for the flat notes, 0.398 with the model
(0.493 -> 0.399 around note changes).

Rebuild it with `voice/tools/humanizer/` (`extract.mjs` then `train.py ... 3000`, PyTorch).
