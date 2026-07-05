import math
import wave
from pathlib import Path

out = Path('assets/audio/adventure-loop.wav')
out.parent.mkdir(parents=True, exist_ok=True)

sample_rate = 22050
seconds = 8.0
freqs = [440.0, 554.37, 659.25, 830.61]
frames = bytearray()

for i in range(int(sample_rate * seconds)):
    t = i / sample_rate
    note = freqs[(i // (sample_rate // 8)) % len(freqs)]
    value = math.sin(2 * math.pi * note * t) * 0.34
    value += math.sin(2 * math.pi * (note * 1.5) * t) * 0.18
    value += math.sin(2 * math.pi * (note * 0.5) * t) * 0.1

    envelope = 1.0 - ((t % 2.0) / 2.0)
    envelope = max(0.0, min(1.0, envelope))
    if int(t * 2.0) % 2 == 1:
        envelope *= 0.92

    sample = int(max(-1.0, min(1.0, value * envelope)) * 0.65 * 32767)
    frames.extend((sample & 0xFF, (sample >> 8) & 0xFF))

with wave.open(str(out), 'wb') as wav_file:
    wav_file.setnchannels(1)
    wav_file.setsampwidth(2)
    wav_file.setframerate(sample_rate)
    wav_file.writeframes(frames)

print(out)
