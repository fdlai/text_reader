# Text Reader

Paste a link to any article or web novel chapter and have it read aloud in a
natural voice, with the text highlighted word by word as it plays. You choose (or design) the narrator's voice,
and most voices run on your own computer for free.

## Features

- **Read anything from a URL.** The article text is extracted from the page
  and saved to your library.
- **Three kinds of voices:**
  - **Kokoro**: free, fast, runs on any computer's CPU. 28 built-in English voices.
  - **Qwen3-TTS**: free and very natural, runs on an NVIDIA GPU. Design your
    own narrator by describing it ("male, 40s, American accent, deep and calm"),
    try samples until one sounds right, and save it. *(Optional, see below.)*
  - **OpenAI** (gpt-4o-mini-tts): paid, about 1.5 cents per minute of audio,
    with style instructions ("warm, relaxed narrator").
- **Starts playing quickly.** Audio is generated section by section, so you
  can start listening while the rest is still being made. Audio is saved, so
  replaying costs nothing (neither money nor generation time).
- **Word-by-word highlighting** that follows along and keeps the current line
  on screen, with a "Back to current" button if you scroll away.
- **Player** with a progress bar, ±15 seconds, playback speed (0.5×–3×),
  "Play from here" on any selected text, and resume where you left off.
- **Pronunciation fixes:** teach the voices how to say names ("Heo Do Jinin"
  → "Heeoh Doh Jeenin") and regenerate just the affected sections.
- **Generation queue:** queue up many articles; one generates at a time, and
  whatever you're listening to jumps to the front.
- **Display preferences:** light, dark, paper or automatic theme, font, font
  size (up to 60px for reading across the room), page width, text alignment
  and highlight color.
- **Keyboard shortcuts** on the article page: **Space** play/pause,
  **P** open/close Preferences.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router
- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2 (async) with asyncpg, Alembic, Pydantic v2
- **Database:** PostgreSQL
- **Speech:** kokoro-onnx, Qwen3-TTS via [qwentts.cpp](https://github.com/ServeurpersoCom/qwentts.cpp)
  in Docker, OpenAI's API
- **Word timings:** faster-whisper (local) listens to the generated audio
  and lines it up with the text

## Setup

These steps run the app directly on your computer. (A one-command Docker
setup is planned.) Commands are for Windows PowerShell; on macOS/Linux, the
differences are noted, and `curl.exe` is just `curl`.

### 1. Install the prerequisites

- **Python 3.13.** 3.14 is too new for some of the libraries.
- **Node.js 22** (or 20.19+)
- **PostgreSQL** (any recent version)
- *Optional, for Qwen voices:* **Docker Desktop** and an **NVIDIA GPU** with
  at least 4 GB of video memory (see [Qwen voices](#optional-qwen-voices-nvidia-gpu)). Qwen voices are very good, and at no cost for use, it's highly recommended if you can run it.

### 2. Get the code

```
git clone https://github.com/fdlai/text_reader.git
cd text_reader
```

### 3. Create the database

```
psql -U postgres -c "CREATE DATABASE text_reader;"
```

(Or create a database named `text_reader` in pgAdmin.)

### 4. Set up the backend

```
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

If PowerShell refuses to run `activate` ("running scripts is disabled"),
allow it for your user once with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Create your settings file by copying the template, then open `backend/.env`
and put in your PostgreSQL password:

```
copy .env.example .env          # macOS/Linux: cp .env.example .env
```

Download the two Kokoro voice model files (about 350 MB) into
`backend/models/kokoro/`:

```
mkdir models\kokoro
curl.exe -L -o models/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl.exe -L -o models/kokoro/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Create the database tables, then start the backend:

```
alembic upgrade head
uvicorn app.main:app --port 8000
```

The first time audio is generated, the speech-timing model (Whisper,
about 150 MB) downloads itself into `backend/models/whisper/`.

### 5. Start the frontend

In a second terminal:

```
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Paste an article's URL into the Library page
to get started.

### Optional: OpenAI voices

Create an API key at https://platform.openai.com/api-keys and add it to
`backend/.env`:

```
OPENAI_API_KEY=sk-...
```

Restart the backend afterwards. The OpenAI voices are paid (about 1.5 cents
per minute of audio, roughly 90 cents per hour). Setting a monthly budget
limit in your OpenAI account is a good idea.

### Optional: Qwen voices (NVIDIA GPU)

Qwen voices sound great and cost nothing, but they need:

- an **NVIDIA GPU** with at least 4 GB of video memory, and an up-to-date driver
- **Docker Desktop**, running (on Windows it uses WSL 2, which supports the GPU)

Download the three model files (about 2.4 GB) into `backend/models/qwen/`:

```
mkdir models\qwen
curl.exe -L -o models/qwen/qwen-talker-1.7b-voicedesign-Q8_0.gguf https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/qwen-talker-1.7b-voicedesign-Q8_0.gguf
curl.exe -L -o models/qwen/qwen-talker-1.7b-base-Q8_0.gguf https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/qwen-talker-1.7b-base-Q8_0.gguf
curl.exe -L -o models/qwen/qwen-tokenizer-12hz-Q8_0.gguf https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF/resolve/main/qwen-tokenizer-12hz-Q8_0.gguf
```

Nothing else to install: the first time you use Qwen, the app downloads the
Qwen Docker image (about 2.6 GB) and copies the models into Docker. The first
sample takes a few minutes; after that, the model starts in seconds.

Then go to **Voices → Create a voice**, describe a voice, and generate
samples until you find one you like. Saving it makes it available in the
article page's voice menu right away.

How it runs: the app starts the Qwen container when it's needed and stops it
after 5 idle minutes, so it only uses your GPU while generating. Qwen
generates faster than real time on an RTX 3050 Ti (4 GB), but it's tight on
memory, so closing other GPU-heavy apps (games, many browser tabs) keeps it
fast.

## Troubleshooting

- **"Docker Desktop isn't running"** on the Voices or article page: start
  Docker Desktop, wait until it says it's running, then click **Check again**.
- **Docker Desktop stuck on "Starting the Docker Engine…"** (Windows): quit
  it from the system tray, run `wsl --shutdown` in PowerShell, then start it
  again.
- **OpenAI says the API key is invalid**, even though `.env` is right: an
  `OPENAI_API_KEY` set as a Windows environment variable overrides `.env`.
  Remove it (System Properties → Environment Variables), then restart your
  terminal or editor.
- **Some sites don't work:** pages that build their text with JavaScript
  after loading, or that block automated requests, can't be extracted yet.

## Project layout

```
backend/
  app/
    main.py           app startup, routes
    models.py         database tables
    routers/          API endpoints (documents, audio, voices, ...)
    services/         text extraction, chunking, speech engines,
                      word timing, generation queue, Qwen container control
  alembic/            database migrations
  models/             downloaded model files (git-ignored)
  storage/            generated audio and saved voice samples (git-ignored)
frontend/
  src/
    pages/            Library, Reader (article page), Voices
    components/       player bar, preferences panel, ...
    context/          player state, display preferences
```
