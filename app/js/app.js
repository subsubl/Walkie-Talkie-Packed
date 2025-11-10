import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

const SPIXI_PROTOCOL_ID = "com.ixilabs.spixi.walkie-talkie";

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

async function decodeAudioData(
  data,
  ctx,
  sampleRate,
  numChannels,
) {
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


const App = () => {
    const [status, setStatus] = useState('Initializing...');
    const [transcript, setTranscript] = useState([]);
    const [isRecording, setIsRecording] = useState(false);
    const isRecordingRef = useRef(isRecording);

    const sessionPromise = useRef(null);
    const streamRef = useRef(null);
    const outputAudioContextRef = useRef(null);
    const nextStartTimeRef = useRef(0);
    const transcriptEndRef = useRef(null);
    
    const currentInputTranscription = useRef('');

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    useEffect(() => {
        const scrollToBottom = () => {
            transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        };
        scrollToBottom();
    }, [transcript]);

    useEffect(() => {
        // --- Spixi SDK Handlers ---
        SpixiAppSdk.onNetworkData = (senderAddress, data) => {
            const outputAudioContext = outputAudioContextRef.current;
            if (!outputAudioContext) return;
            
            (async () => {
                try {
                    const audioBytes = decode(data);
                    // Incoming audio is 16kHz from the microphone
                    const audioBuffer = await decodeAudioData(audioBytes, outputAudioContext, 16000, 1);
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
                    const source = outputAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputAudioContext.destination);
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                } catch (e) {
                    console.error("Failed to process incoming audio", e);
                }
            })();
        };
        
        SpixiAppSdk.onNetworkProtocolData = (senderAddress, protocolId, data) => {
             if (protocolId === SPIXI_PROTOCOL_ID) {
                const messageText = SpixiTools.unescapeParameter(data);
                setTranscript(prev => [...prev, { from: 'peer', text: messageText.trim() }]);
            }
        };

        async function init() {
            try {
                setStatus('Requesting Permissions...');
                streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                setStatus('Connecting to Gemini...');
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

                outputAudioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                
                sessionPromise.current = ai.live.connect({
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
                            setStatus('Ready');
                            const inputAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                            const source = inputAudioContext.createMediaStreamSource(streamRef.current);
                            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

                            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                                if (!isRecordingRef.current) return;
                                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                                const pcmBlob = createBlob(inputData);
                                
                                // Send to Gemini for STT
                                sessionPromise.current?.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                                // Send to peer via Spixi
                                SpixiAppSdk.sendNetworkData(pcmBlob.data);
                            };

                            source.connect(scriptProcessor);
                            scriptProcessor.connect(inputAudioContext.destination);
                        },
                        onmessage: async (message) => {
                            // Only process input transcription from Gemini, ignore any audio/text response
                            if (message.serverContent?.inputTranscription) {
                                currentInputTranscription.current += message.serverContent.inputTranscription.text;
                            }
                            if (message.serverContent?.turnComplete) {
                                if (currentInputTranscription.current) {
                                    const text = currentInputTranscription.current.trim();
                                    setTranscript(prev => [...prev, { from: 'user', text }]);
                                    SpixiAppSdk.sendNetworkProtocolData(SPIXI_PROTOCOL_ID, SpixiTools.escapeParameter(text));
                                    currentInputTranscription.current = '';
                                }
                            }
                        },
                        onerror: (e) => {
                            console.error(e);
                            setStatus(`Error: ${e.message}`);
                        },
                        onclose: () => {
                            setStatus('Connection Closed');
                        },
                    },
                });

            } catch (error) {
                console.error('Initialization failed:', error);
                setStatus('Error: Could not initialize. Please check permissions and refresh.');
            }
        }

        init();

        return () => {
            streamRef.current?.getTracks().forEach(track => track.stop());
            outputAudioContextRef.current?.close();
            sessionPromise.current?.then(session => session.close());
        };
    }, []);

    const handlePress = () => {
        if (status === 'Ready') {
            setIsRecording(true);
        }
    };

    const handleRelease = () => {
        setIsRecording(false);
    };

    const buttonText = isRecording ? 'Recording...' : 'Push to Talk';
    const isDisabled = status !== 'Ready';

    return (
        <div className="container">
            <header className="header">
                <h1 className="title">Walkie-Talkie</h1>
                <p className="status">Status: {status}</p>
            </header>
            <main className="transcript-container">
                {transcript.map((entry, index) => (
                    <div key={index} className={`message ${entry.from === 'user' ? 'user-message' : 'peer-message'}`}>
                       <strong>{entry.from === 'user' ? 'You:' : 'Peer:'}</strong> {entry.text}
                    </div>
                ))}
                <div ref={transcriptEndRef} />
            </main>
            <footer className="footer">
                <button
                    className={`button ${isRecording ? 'active' : ''}`}
                    onMouseDown={handlePress}
                    onMouseUp={handleRelease}
                    onTouchStart={handlePress}
                    onTouchEnd={handleRelease}
                    disabled={isDisabled}
                    aria-label={buttonText}
                >
                    <div className="mic-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path>
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path>
                        </svg>
                    </div>
                </button>
            </footer>
        </div>
    );
};

SpixiAppSdk.onInit = (sessionId, userAddresses) => {
    const container = document.getElementById('root');
    if(container) {
        const root = createRoot(container);
        root.render(<App />);
    }
};

window.onload = SpixiAppSdk.fireOnLoad;