import { GoogleGenAI, Modality, Blob } from "@google/genai";

const SPIXI_PROTOCOL_ID = "com.ixilabs.spixi.walkie-talkie";

// --- DOM Elements ---
const statusEl = document.getElementById('status');
const transcriptContainerEl = document.getElementById('transcriptContainer');
const talkButtonEl = document.getElementById('talkButton');

// --- State ---
let status = 'Initializing...';
let isRecording = false;
let currentInputTranscription = '';

// --- API & Media Refs ---
let sessionPromise = null;
let stream = null;
let outputAudioContext = null;
let nextStartTime = 0;

// --- Helper Functions for Audio Encoding/Decoding ---
function encode(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data) {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

// --- UI Update Functions ---
function updateStatus(newStatus) {
    status = newStatus;
    statusEl.textContent = `Status: ${status}`;
    talkButtonEl.disabled = status !== 'Ready';
}

function addTranscriptEntry(from, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${from === 'user' ? 'userMessage' : 'peerMessage'}`;
    messageDiv.innerHTML = `<strong>${from === 'user' ? 'You:' : 'Peer:'}</strong> ${text}`;
    transcriptContainerEl.appendChild(messageDiv);
    transcriptContainerEl.scrollTop = transcriptContainerEl.scrollHeight;
}

// --- Event Handlers ---
function handlePress() {
    if (status === 'Ready') {
        isRecording = true;
        talkButtonEl.classList.add('active');
        if (outputAudioContext.state === 'suspended') {
            outputAudioContext.resume();
        }
    }
}

function handleRelease() {
    isRecording = false;
    talkButtonEl.classList.remove('active');
}

// --- Main Initialization ---
async function init() {
    try {
        updateStatus('Requesting Permissions...');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        updateStatus('Connecting to Gemini...');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

        sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                },
                systemInstruction: "You are a transcription service. Your only job is to transcribe the user's audio accurately.",
                inputAudioTranscription: {},
            },
            callbacks: {
                onopen: () => {
                    updateStatus('Ready');
                    const inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                    const source = inputAudioContext.createMediaStreamSource(stream);
                    const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

                    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        if (!isRecording) return;
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);

                        sessionPromise.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                        SpixiAppSdk.sendNetworkData(pcmBlob.data);
                    };

                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContext.destination);
                },
                onmessage: async (message) => {
                    if (message.serverContent?.inputTranscription) {
                        currentInputTranscription += message.serverContent.inputTranscription.text;
                    }
                    if (message.serverContent?.turnComplete) {
                        if (currentInputTranscription) {
                            const text = currentInputTranscription.trim();
                            addTranscriptEntry('user', text);
                            SpixiAppSdk.sendNetworkProtocolData(SPIXI_PROTOCOL_ID, SpixiTools.escapeParameter(text));
                            currentInputTranscription = '';
                        }
                    }
                },
                onerror: (e) => {
                    console.error(e);
                    updateStatus(`Error: ${e.message}`);
                },
                onclose: () => {
                    updateStatus('Connection Closed');
                },
            },
        });

    } catch (error) {
        console.error('Initialization failed:', error);
        updateStatus('Error: Could not initialize.');
    }
}

// --- Spixi SDK Handlers ---
SpixiAppSdk.onInit = (sessionId, userAddresses) => {
    init();
};

SpixiAppSdk.onNetworkData = (senderAddress, data) => {
    if (!outputAudioContext) return;
    (async () => {
        try {
            const audioBytes = decode(data);
            const audioBuffer = await decodeAudioData(audioBytes, outputAudioContext, 16000, 1);
            nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
            const source = outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputAudioContext.destination);
            source.start(nextStartTime);
            nextStartTime += audioBuffer.duration;
        } catch (e) {
            console.error("Failed to process incoming audio", e);
        }
    })();
};

SpixiAppSdk.onNetworkProtocolData = (senderAddress, protocolId, data) => {
    if (protocolId === SPIXI_PROTOCOL_ID) {
        const messageText = SpixiTools.unescapeParameter(data);
        addTranscriptEntry('peer', messageText.trim());
    }
};


// --- Attach Event Listeners ---
talkButtonEl.addEventListener('mousedown', handlePress);
talkButtonEl.addEventListener('mouseup', handleRelease);
talkButtonEl.addEventListener('touchstart', handlePress, { passive: true });
talkButtonEl.addEventListener('touchend', handleRelease);

// --- Start the App ---
SpixiAppSdk.fireOnLoad();
