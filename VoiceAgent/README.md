# Voice-Controlled Multi-Service Agent

A sophisticated voice-controlled agent system that runs on a single 24GB GPU and coordinates with multiple remote services and tools.

## Architecture

### Two-Model Approach

1. **Router Model (Small, 1-3B parameters)**
   - Purpose: Fast intent classification (~50-100ms)
   - Memory: ~2GB VRAM
   - Recommended models:
     - Qwen2.5-3B-Instruct (default)
     - Phi-3-mini (3.8B)
     - TinyLlama-1.1B

2. **Main Model (Medium, 7-14B parameters)**
   - Purpose: Reasoning, planning, execution, conversation
   - Memory: ~5-9GB VRAM
   - Recommended models:
     - Qwen2.5-14B-Instruct (most capable)
     - Qwen2.5-7B-Instruct (balanced)
     - Mistral-7B-Instruct

### Three Operational Modes

The router classifies each user input into one of three modes:

1. **Planning Mode**
   - Complex multi-step task breakdown
   - Service coordination strategy
   - Dependency analysis

2. **Execution Mode**
   - Direct actions and API calls
   - Job status queries and modifications
   - Pronoun resolution for active tasks

3. **Conversation Mode**
   - Natural dialogue
   - General questions
   - Background task awareness

## Features

- **Real-time Voice I/O**: Speech-to-text (Whisper) and text-to-speech (SpeechT5)
- **Service Integration**: Connect to MusicGen, SDXL, LocalChat, RAG, and more
- **Async Job Management**: Track long-running tasks with progress updates
- **WebSocket Updates**: Real-time notifications for job completion
- **Streaming Responses**: Token-by-token response streaming

## Memory Budget (24GB GPU)

| Component | Memory |
|-----------|--------|
| Router Model (Q4) | ~2GB |
| Main Model (Q4/Q5) | ~5-9GB |
| STT (Whisper-base) | ~0.5GB |
| TTS (SpeechT5) | ~0.5GB |
| KV Cache | 3-5GB |
| Overhead | 5-9GB |

## Quick Start

1. **Prerequisites**
   - Python virtual environment with dependencies:
     ```
     pip install torch transformers fastapi uvicorn aiohttp
     pip install datasets  # For TTS speaker embeddings
     ```

2. **Start the Server**
   - Open VoiceAgent workflow in ContextUI
   - Select your Python venv
   - Click "Start" to launch the server

3. **Load Models**
   - Load Router Model (fast intent classification)
   - Load Main Model (reasoning and generation)
   - Optionally load Voice Models (STT + TTS)

4. **Start Chatting**
   - Type messages or use "Push to Talk" for voice input
   - The system automatically routes to the appropriate mode

## API Endpoints

### Model Management
- `POST /load_router` - Load router model
- `POST /load_main` - Load main model
- `POST /load_stt` - Load speech-to-text
- `POST /load_tts` - Load text-to-speech
- `POST /unload_all` - Free all models

### Agent Interaction
- `POST /agent/chat` - Send message (non-streaming)
- `POST /agent/stream` - Send message (streaming)
- `POST /agent/voice` - Process voice input

### Job Management
- `POST /jobs/submit` - Submit new job
- `GET /jobs` - List all jobs
- `GET /jobs/{id}` - Get job status
- `POST /jobs/{id}/modify` - Modify job
- `POST /jobs/{id}/cancel` - Cancel job

### Service Registry
- `POST /services/register` - Register service
- `GET /services` - List services
- `DELETE /services/{name}` - Unregister service

## Service Integration

The agent can coordinate with other ContextUI workflows:

| Service | Port | Capabilities |
|---------|------|--------------|
| MusicGen | 8765 | generate, generate_extended |
| LocalChat | 8766 | chat, chat_stream |
| SDXL | 8767 | generate, img2img |
| WorkflowAgent | 8770 | create_workflow, list_workflows |
| RAG | 8771 | search, query |

Register services in the "Services" tab to enable the agent to call them.

## Example Interactions

**Planning Mode:**
> "Generate a jazz piano piece and save it to my music folder"

**Execution Mode:**
> "Make it twice as long"
> "What's the status?"
> "Cancel that"

**Conversation Mode:**
> "What's the weather?"
> "Tell me a joke"

## Customization

Edit `system_prompts.json` to customize:
- Mode-specific system prompts
- Router classification examples
- Tool descriptions and examples

## Troubleshooting

**Models not loading:**
- Ensure sufficient VRAM
- Try smaller models first
- Check HuggingFace cache path

**Voice not working:**
- Verify microphone permissions
- Load both STT and TTS models
- Check browser audio support

**Services not responding:**
- Verify services are running on expected ports
- Register services manually in Services tab
- Check service health endpoints

## Files

- `voice_agent_server.py` - FastAPI backend server
- `VoiceAgentWindow.tsx` - React UI component
- `service_connectors.py` - Service integration layer
- `system_prompts.json` - Configurable prompts
