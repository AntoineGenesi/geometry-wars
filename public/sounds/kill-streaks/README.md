# Kill Streak Voice Clips

## TTS Tool
Generated using **edge-tts** v7.2.7 (Microsoft Edge Neural TTS, free for personal use).

## Voice
- **en-US-GuyNeural** (Male, "Passion" style)
- Rate: +10%, Pitch: +5Hz (slightly faster/higher for announcer feel)
- "Legendary" clip uses +10Hz pitch for extra emphasis

## Clips

| File | Trigger | Streak Count |
|------|---------|-------------|
| double-kill.mp3 | Multi-kill | 2 |
| triple-kill.mp3 | Multi-kill | 3 |
| overkill.mp3 | Multi-kill | 4 |
| killtacular.mp3 | Multi-kill | 5 |
| killing-frenzy.mp3 | Multi-kill | 6 |
| running-riot.mp3 | Multi-kill | 7 |
| rampage.mp3 | Multi-kill | 8 |
| untouchable.mp3 | Multi-kill | 9 |
| invincible.mp3 | Multi-kill | 10+ |
| killing-spree.mp3 | Spree (5+ without dying) | - |
| killjoy.mp3 | Ending enemy spree | - |
| legendary.mp3 | Special (6+ in KSA) | - |

## How to Regenerate

```bash
pip3 install edge-tts
VOICE="en-US-GuyNeural"
RATE="+10%"
PITCH="+5Hz"
edge-tts --voice "$VOICE" --rate "$RATE" --pitch "$PITCH" --text "Double Kill!" --write-media double-kill.mp3
# Repeat for each clip...
```

## License
Edge TTS uses Microsoft's Azure Cognitive Services voices. These are free for personal/non-commercial use via the edge-tts library. For commercial use, check Microsoft's Azure TTS licensing terms.

## Audio Normalization
Clips are at edge-tts default levels. If ffmpeg is available, normalize to -3dBFS:
```bash
for f in *.mp3; do ffmpeg -i "$f" -af loudnorm=I=-3:TP=-1 -y "norm_$f" && mv "norm_$f" "$f"; done
```
