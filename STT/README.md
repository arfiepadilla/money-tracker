# Speech-to-Text (STT) Workflow

A real-time speech transcription service using OpenAI's Whisper models. Convert audio to text with high accuracy in multiple languages.

## Features

- **Real-time Transcription**: Record from your microphone and get instant transcriptions
- **Multiple Whisper Models**: Choose from Tiny, Base, Small, Medium, or Large models
- **Multi-language Support**: Auto-detect or specify languages (100+ languages supported)
- **Translation**: Translate speech to English from any language
- **Batch Processing**: Transcribe multiple audio files at once
- **File Upload**: Upload audio files for transcription
- **History Tracking**: View and export transcription history
- **VRAM Monitoring**: Track GPU memory usage

## Models

| Model | Size | Speed | Accuracy | VRAM Usage |
|-------|------|-------|----------|------------|
| Whisper Tiny | ~150MB | Fastest | Good | ~1GB |
| Whisper Base | ~290MB | Very Fast | Better | ~1.5GB |
| Whisper Small | ~970MB | Fast | Great | ~2.5GB |
| Whisper Medium | ~3GB | Moderate | Excellent | ~5GB |
| Whisper Large v3 | ~6GB | Slower | Best | ~10GB |

## Requirements

### Python Packages

The following packages are required and will be automatically installed:
- `fastapi` - Web server framework
- `uvicorn` - ASGI server
- `torch` - PyTorch (with CUDA support)
- `transformers` - HuggingFace Transformers
- `accelerate` - Model acceleration
- `huggingface_hub` - Model downloads
- `numpy` - Numerical computing
- `soundfile` - Audio file processing

### System Requirements

- **GPU**: NVIDIA GPU with CUDA support (recommended)
- **RAM**: 8GB+ recommended
- **VRAM**: Varies by model (see table above)
- **Disk Space**: 150MB - 6GB depending on model

## Usage

### 1. Setup

1. Open the STT Window
2. Select a Python virtual environment
3. Click "Install Missing Dependencies" if needed
4. Start the server
5. Select and load a Whisper model

### 2. Real-time Transcription

1. Go to the "Transcribe" tab
2. Select your microphone from the dropdown
3. Choose language (or auto-detect)
4. Select task (Transcribe or Translate)
5. Click "Start Recording" to begin
6. Speak into your microphone
7. Click "Stop Recording" when done
8. View the transcription

### 3. Batch Processing

Use the API endpoint `/transcribe_batch` to process multiple audio files:

```python
import requests
import base64

# Read audio files and encode to base64
audio_files_b64 = []
for file_path in audio_files:
    with open(file_path, 'rb') as f:
        audio_b64 = base64.b64encode(f.read()).decode()
        audio_files_b64.append(audio_b64)

# Transcribe batch
response = requests.post('http://127.0.0.1:8781/transcribe_batch', json={
    'audio_files_b64': audio_files_b64,
    'sample_rate': 16000,
    'format': 'wav',
    'language': 'en',
    'task': 'transcribe'
})

results = response.json()['results']
for result in results:
    print(f"Transcription {result['index']}: {result['transcription']}")
```

### 4. File Upload

Use the `/transcribe_file` endpoint to upload audio files directly:

```python
import requests

with open('audio.wav', 'rb') as f:
    files = {'file': f}
    response = requests.post('http://127.0.0.1:8781/transcribe_file', files=files)

result = response.json()
print(result['transcription'])
```

## API Endpoints

### Server Management

- `GET /` - Server status
- `GET /health` - Health check
- `GET /status` - Detailed status including model and VRAM
- `POST /shutdown` - Gracefully shutdown server

### Model Management

- `POST /load_model` - Load a Whisper model
- `POST /unload_model` - Unload model to free VRAM
- `GET /cached_models` - List downloaded models

### Transcription

- `POST /transcribe` - Transcribe a single audio file (base64)
- `POST /transcribe_batch` - Transcribe multiple audio files
- `POST /transcribe_file` - Upload and transcribe a file

### History

- `GET /history?limit=50` - Get transcription history
- `POST /history/clear` - Clear history

### Dependencies

- `GET /env/packages` - List installed packages
- `POST /env/check_deps` - Check specific packages
- `POST /env/install_packages` - Install packages

## Supported Languages

Whisper supports 100+ languages including:

- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Dutch (nl)
- Russian (ru)
- Chinese (zh)
- Japanese (ja)
- Korean (ko)
- Arabic (ar)
- Hindi (hi)
- And many more...

Set `language: null` for auto-detection.

## Translation

Whisper can translate speech from any language to English:

```json
{
  "audio_b64": "base64_encoded_audio",
  "task": "translate",
  "language": "fr"
}
```

This will transcribe French audio and translate it to English.

## Audio Format

The server accepts audio in various formats:
- **WAV** (recommended): PCM 16-bit
- **WEBM**: With Opus codec
- **Other formats**: Supported via soundfile library

Audio is automatically resampled to 16kHz mono for Whisper processing.

## Performance Tips

1. **Model Selection**:
   - Use Tiny/Base for real-time applications
   - Use Small/Medium for better accuracy
   - Use Large for best quality (slower)

2. **GPU Acceleration**:
   - Ensure CUDA is available for significant speedup
   - Monitor VRAM usage to avoid OOM errors

3. **Audio Quality**:
   - Use clear audio with minimal background noise
   - 16kHz sample rate is optimal
   - Mono audio is preferred

4. **Batch Processing**:
   - Process multiple files in batches for efficiency
   - Larger batches may use more VRAM

## Troubleshooting

### Model Loading Errors

- Ensure sufficient VRAM for the selected model
- Check internet connection for model downloads
- Verify CUDA installation for GPU support

### Audio Processing Errors

- Ensure audio is in a supported format
- Check that soundfile library is installed
- Verify audio file is not corrupted

### Poor Transcription Quality

- Try a larger model (Small/Medium/Large)
- Improve audio quality (reduce noise, clear speech)
- Specify the correct language instead of auto-detect

## Integration with Other Workflows

The STT service can be integrated with other workflows:

### Voice Agent Integration

The VoiceAgent workflow already uses STT for voice input. You can use this standalone STT service for:
- Offline transcription
- Custom transcription pipelines
- Integration with other tools

### Custom Applications

Access the STT API from any application:

```python
import requests
import base64

def transcribe_audio(audio_path):
    with open(audio_path, 'rb') as f:
        audio_b64 = base64.b64encode(f.read()).decode()

    response = requests.post('http://127.0.0.1:8781/transcribe', json={
        'audio_b64': audio_b64,
        'sample_rate': 16000,
        'format': 'wav'
    })

    return response.json()['transcription']
```

## Environment Variables

The server respects the following ContextUI environment variables:

- `CONTEXTUI_MODELS_PATH` - HuggingFace models cache location
- `CONTEXTUI_GENERATED_PATH` - Generated content storage
- `CONTEXTUI_PROFILE_PATH` - User profile path

## Default Port

The STT server runs on port **8781** by default. You can change this in the UI or via command line:

```bash
python stt_server.py 8782
```

## Credits

This workflow uses:
- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition model
- [HuggingFace Transformers](https://huggingface.co/transformers/) - Model implementation
- [FastAPI](https://fastapi.tiangolo.com/) - Web framework
