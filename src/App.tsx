/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, Play, Volume2, FileText, Languages, User, Globe, 
  Loader2, X, CheckCircle2, AlertCircle, Download, History, 
  Trash2, Clock, Sparkles, Mic2, Heart 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Modality } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';

// --- Constants ---
const LANGUAGES = ["English", "Arabic", "French", "Chinese", "Russian", "Spanish", "German", "Japanese", "Italian", "Portuguese", "Hindi", "Korean"];
const ACCENTS = ["Native", "American", "British", "Australian", "Indian", "Chinese", "Russian", "French", "Arabic", "Spanish", "German", "Italian"];
const FEELINGS = ["Native", "Friendly", "Angry", "Sexy", "Serious", "Childish", "Sad", "Excited", "Whispering", "Professional"];

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Set worker path for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

function pcmToWav(base64Pcm: string): string {
  try {
    const binaryString = window.atob(base64Pcm);
    const len = binaryString.length;
    const pcmData = new Uint8Array(len);
    for (let i = 0; i < len; i++) pcmData[i] = binaryString.charCodeAt(i);

    const numChannels = 1;
    const sampleRate = 24000;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length;
    const chunkSize = 36 + dataSize;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, chunkSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44).set(pcmData);

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("Error converting PCM to WAV:", error);
    throw new Error("Failed to process audio data.");
  }
}

// --- TTS Service ---
async function generateSpeech({ text, language, gender, accent, feeling }: any): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  const voiceName = gender === 'male' ? 'Puck' : 'Kore';
  const toneDescription = feeling === 'Native' ? "natural and proper" : feeling.toLowerCase();

  const prompt = `Read the following text in ${language} with a ${accent} accent as a ${gender}. The tone should be ${toneDescription}.\n\nText:\n${text}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio data returned. Check content safety filters.");
  return base64Audio;
}

// --- Main App Component ---
interface HistoryItem {
  id: string;
  text: string;
  language: string;
  accent: string;
  gender: string;
  feeling: string;
  timestamp: number;
  audioBase64: string;
}

export default function App() {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState('English');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [accent, setAccent] = useState('Native');
  const [feeling, setFeeling] = useState('Native');
  const [isLoading, setIsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('accentify_history');
    if (saved) try { setHistory(JSON.parse(saved)); } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    localStorage.setItem('accentify_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    return () => { if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl); };
  }, [audioUrl]);

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setIsLoading(true);
    try {
      const extractedText = file.type === 'application/pdf' ? await extractTextFromPdf(file) : await file.text();
      setText(extractedText);
    } catch (err) { setError('Failed to read file.'); } finally { setIsLoading(false); }
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop, accept: { 'text/plain': ['.txt'], 'application/pdf': ['.pdf'] }, multiple: false, noClick: true,
  });

  const handleGenerate = async () => {
    if (!text.trim()) { setError('Please enter some text.'); return; }
    setIsLoading(true);
    setError(null);
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    try {
      const base64 = await generateSpeech({ text: text.slice(0, 5000), language, gender, accent: accent === 'Native' ? 'standard' : accent, feeling });
      const url = pcmToWav(base64);
      setAudioUrl(url);
      const newItem: HistoryItem = { id: crypto.randomUUID(), text: text.slice(0, 100), language, accent, gender, feeling, timestamp: Date.now(), audioBase64: base64 };
      setHistory(prev => [newItem, ...prev].slice(0, 20));
    } catch (err: any) { setError(err.message || 'Failed to generate speech.'); } finally { setIsLoading(false); }
  };

  const playFromHistory = (item: HistoryItem) => {
    if (audioUrl?.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    setAudioUrl(pcmToWav(item.audioBase64));
    setText(item.text);
    setLanguage(item.language);
    setAccent(item.accent);
    setGender(item.gender as any);
    setFeeling(item.feeling || 'Native');
  };

  const deleteHistoryItem = (id: string) => {
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearHistory = () => {
    if (window.confirm('Purge all session history?')) {
      setHistory([]);
      localStorage.removeItem('accentify_history');
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-emerald-500/30 relative overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl px-6 py-3 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Mic2 className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none uppercase">ACCENTIFY</h1>
              <p className="text-[10px] font-mono text-emerald-500/70 uppercase tracking-widest mt-1">Neural TTS Engine</p>
            </div>
          </div>
          <button onClick={open} className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 transition-all">
            <Upload className="w-3 h-3" /> Import
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
            <div className="px-8 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Content Input</span>
              </div>
              {fileName && (
                <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                  <span className="text-[10px] font-medium text-emerald-400 truncate max-w-[200px]">{fileName}</span>
                  <button onClick={() => { setFileName(null); setText(''); }} className="hover:text-emerald-300"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
            <div {...getRootProps()} className={cn("relative min-h-[400px] flex-1", isDragActive && "bg-emerald-500/5")}>
              <input {...getInputProps()} />
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to synthesize..." className="w-full h-full bg-transparent p-8 text-xl font-light leading-relaxed focus:outline-none placeholder:text-zinc-800 resize-none" />
              {!text && !isDragActive && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center opacity-20">
                  <FileText className="w-12 h-12 mb-4" />
                  <p className="text-sm font-mono uppercase tracking-widest">Awaiting Input</p>
                </div>
              )}
            </div>
            <div className="px-8 py-3 bg-white/[0.02] border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
              <span>{text.length} Characters</span>
              <span>Mode: {fileName ? 'Stream' : 'Direct'}</span>
            </div>
          </div>

          <section className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl overflow-hidden shadow-xl">
            <div className="px-8 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Recent Sessions</span>
              </div>
              {history.length > 0 && <button onClick={clearHistory} className="text-[10px] font-bold text-zinc-600 hover:text-red-400 transition-colors uppercase tracking-widest">Purge All</button>}
            </div>
            <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto">
              {history.length === 0 ? (
                <div className="p-12 text-center opacity-20">
                  <Clock className="w-8 h-8 mx-auto mb-3" />
                  <p className="text-[10px] font-mono uppercase tracking-widest">Archive Empty</p>
                </div>
              ) : (
                history.map((item) => (
                  <div key={item.id} className="group px-8 py-4 flex items-center justify-between hover:bg-white/[0.03] transition-all">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => playFromHistory(item)}>
                      <p className="text-sm text-zinc-400 truncate mb-1 font-light italic">"{item.text}..."</p>
                      <div className="flex items-center gap-4 text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                        <span>{item.language}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-800" />
                        <span>{item.accent}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-800" />
                        <span>{item.feeling}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => playFromHistory(item)} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-black transition-all"><Play className="w-3 h-3 fill-current" /></button>
                      <button onClick={() => deleteHistoryItem(item.id)} className="p-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-black transition-all"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl p-8 space-y-8 shadow-2xl relative overflow-hidden">
            <div className="space-y-6 relative z-10">
              <div className="flex items-center gap-2"><Languages className="w-4 h-4 text-emerald-500" /><h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">Parameters</h2></div>
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all appearance-none cursor-pointer">
                  {LANGUAGES.map(lang => <option key={lang} value={lang} className="bg-[#0a0a0a]">{lang}</option>)}
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Accent Profile</label>
                <select value={accent} onChange={(e) => setAccent(e.target.value)} className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all appearance-none cursor-pointer">
                  {ACCENTS.map(acc => <option key={acc} value={acc} className="bg-[#0a0a0a]">{acc} Accent</option>)}
                </select>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Voice Model</label>
                <div className="grid grid-cols-2 gap-3">
                  {(['male', 'female'] as const).map((g) => (
                    <button key={g} onClick={() => setGender(g)} className={cn("flex items-center justify-center gap-2 py-4 rounded-2xl border transition-all text-[10px] font-bold uppercase tracking-widest", gender === g ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-500/10" : "bg-white/[0.02] border-white/5 text-zinc-500 hover:border-white/20")}>
                      <User className="w-3 h-3" />{g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-600">Emotional Tone</label>
                <select value={feeling} onChange={(e) => setFeeling(e.target.value)} className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-emerald-500/50 transition-all appearance-none cursor-pointer">
                  {FEELINGS.map(f => <option key={f} value={f} className="bg-[#0a0a0a]">{f}</option>)}
                </select>
              </div>
            </div>
            <button onClick={handleGenerate} disabled={isLoading || !text.trim()} className={cn("w-full py-5 rounded-2xl font-bold text-xs uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 relative overflow-hidden group shadow-2xl", isLoading || !text.trim() ? "bg-zinc-900 text-zinc-700 cursor-not-allowed border border-white/5" : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]")}>
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Play className="w-4 h-4 fill-current transition-transform group-hover:scale-110" />Synthesize</>}
            </button>
          </section>

          <AnimatePresence>
            {(audioUrl || error) && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={cn("bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl p-8 shadow-2xl border-l-4", error ? "border-l-red-500/50" : "border-l-emerald-500/50")}>
                {error ? (
                  <div className="flex items-start gap-4 text-red-400"><AlertCircle className="w-5 h-5 shrink-0 mt-1" /><div className="space-y-1"><p className="text-xs font-bold uppercase tracking-widest">System Error</p><p className="text-sm font-light leading-relaxed">{error}</p></div></div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[10px] font-mono text-emerald-400 uppercase tracking-[0.2em]">Audio Stream Ready</span></div>
                      <a href={audioUrl!} download="synthesized_voice.wav" className="p-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] rounded-xl text-emerald-400 transition-all"><Download className="w-4 h-4" /></a>
                    </div>
                    <audio ref={audioRef} src={audioUrl!} controls className="w-full h-12 accent-emerald-500 opacity-80 hover:opacity-100 transition-opacity" autoPlay />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <div className="flex flex-col items-center gap-8">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex flex-col items-center gap-4">
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] px-6 py-2 rounded-full shadow-xl">
              <p className="text-[10px] font-mono uppercase tracking-[0.4em] text-zinc-500 flex items-center gap-3"><span className="w-1 h-1 rounded-full bg-emerald-500" />made by aissa<span className="w-1 h-1 rounded-full bg-emerald-500" /></p>
            </div>
            <p className="text-[9px] font-mono text-zinc-700 uppercase tracking-widest">Advanced Neural Synthesis Platform • 2026</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
