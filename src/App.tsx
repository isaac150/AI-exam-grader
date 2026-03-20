/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { GraduationCap, BookOpen, Camera, CheckCircle, Download, Loader2, AlertCircle, RefreshCw, Send, Sun, Moon, Trash2, History, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// Backend URL
const BACKEND_URL = 'https://backend-production-204f.up.railway.app/get-score';

interface GradingHistoryItem {
  id: string;
  timestamp: number;
  modelAnswer: string;
  studentResponse: string;
  score: number;
  feedback: string;
}

export default function App() {
  const [modelAnswer, setModelAnswer] = useState<string>('');
  const [studentResponse, setStudentResponse] = useState<string>('');
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [ocrLoading, setOcrLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [history, setHistory] = useState<GradingHistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Initialize history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('grading_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  // Save history to localStorage
  useEffect(() => {
    localStorage.setItem('grading_history', JSON.stringify(history));
  }, [history]);

  // Initialize theme from system preference
  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(prefersDark);
  }, []);

  // Handle OCR (Camera Capture)
  const handleOCR = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrLoading(true);
    setError(null);
    setStatus('Scanning handwritten paper...');

    const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GOOGLE_AI_KEY || '';
    if (!apiKey) {
      setError('Gemini API Key is not configured. Please add GEMINI_API_KEY to your project secrets in AI Studio, or VITE_GOOGLE_AI_KEY in Vercel.');
      setOcrLoading(false);
      return;
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      const reader = new FileReader();
      const fileData = await new Promise<{ base64: string; type: string }>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve({
            base64: result.split(',')[1],
            type: file.type || 'image/jpeg'
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const model = "gemini-3-flash-preview";
      const result = await genAI.models.generateContent({
        model,
        contents: {
          parts: [
            { text: "Transcribe everything you see in this image. I need the text content for an automated grading system. If there is handwriting, please do your best to read it. If it's completely blank or unreadable, return nothing." },
            { inlineData: { mimeType: fileData.type, data: fileData.base64 } }
          ]
        }
      });

      const text = result.text || '';
      if (!text.trim()) {
        setStatus('No text detected.');
        setError('No text was found in the image. Tips: Ensure the paper is well-lit, the handwriting is clear, and you are capturing the text directly.');
      } else {
        setStudentResponse(prev => prev ? prev + '\n' + text : text);
        setStatus('Scan complete!');
      }
    } catch (err: any) {
      console.error('OCR Error Detail:', err);
      const errorMessage = err.message || '';
      if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not found')) {
        setError('Gemini API Key is missing or invalid. Please check your project secrets.');
      } else if (errorMessage.includes('quota') || errorMessage.includes('429')) {
        setError('API quota exceeded (Free Tier limit). Please wait 60 seconds and try again.');
      } else {
        setError(`OCR Error: ${errorMessage || 'Failed to scan image. Please ensure the image is clear and try again.'}`);
      }
    } finally {
      setOcrLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Main Evaluation Flow
  const evaluateSubmission = async () => {
    if (!studentResponse.trim()) {
      setError('Please provide a student response to grade.');
      return;
    }

    setLoading(true);
    setError(null);
    setScore(null);
    setFeedback('');

    const apiKey = process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GOOGLE_AI_KEY || '';
    if (!apiKey) {
      setError('Gemini API Key is not configured. Please add GEMINI_API_KEY to your project secrets in AI Studio, or VITE_GOOGLE_AI_KEY in Vercel.');
      setLoading(false);
      return;
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      // 1. Get Score from Backend (SBERT)
      setStatus('Calculating semantic similarity (Backend may take 50s to wake up)...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      try {
        const response = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            model_answer: modelAnswer, 
            student_answer: studentResponse 
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error('Backend scoring failed');
        const data = await response.json();
        const semanticScore = data.score; // 0-10
        setScore(semanticScore);

        // 2. Generate Qualitative Feedback using Gemini
        setStatus('Generating qualitative feedback...');
        const model = "gemini-3-flash-preview";
        const feedbackResult = await genAI.models.generateContent({
          model,
          contents: `Act as a professional examiner. A student scored ${semanticScore}/10 on a theoretical question. 
          Model Answer: "${modelAnswer}"
          Student Response: "${studentResponse}"
          Provide a constructive 2-sentence feedback summary highlighting strengths or areas for improvement.`,
        });
        const finalFeedback = feedbackResult.text || '';
        setFeedback(finalFeedback);
        
        // Save to History
        const historyItem: GradingHistoryItem = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          modelAnswer,
          studentResponse,
          score: semanticScore,
          feedback: finalFeedback
        };
        setHistory(prev => [historyItem, ...prev]);
        
        setStatus('Evaluation complete!');
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          throw new Error('The backend server is taking too long to respond. This usually happens on the first request of the day as the server "wakes up". Please try again in a few seconds.');
        }
        throw fetchErr;
      }
    } catch (err: any) {
      console.error('Evaluation Error:', err);
      const errorMessage = err.message || '';
      if (errorMessage.includes('quota') || errorMessage.includes('429')) {
        setError('API quota exceeded (Free Tier limit). Please wait 60 seconds and try again.');
      } else {
        setError(`Evaluation Error: ${errorMessage || 'Failed to evaluate submission. Please try again.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // PDF Export
  const downloadReport = async () => {
    if (!reportRef.current) return;
    try {
      setStatus('Preparing PDF report...');
      const canvas = await html2canvas(reportRef.current, { 
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
        logging: false
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Grading_Report_${new Date().getTime()}.pdf`);
      setStatus('PDF exported successfully!');
    } catch (err: any) {
      console.error('PDF Generation Error:', err);
      setError(`Failed to generate PDF: ${err.message || 'Unknown error'}`);
    }
  };

  const loadFromHistory = (item: GradingHistoryItem) => {
    setModelAnswer(item.modelAnswer);
    setStudentResponse(item.studentResponse);
    setScore(item.score);
    setFeedback(item.feedback);
    setIsHistoryOpen(false);
    setStatus('Loaded from history');
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const clearHistory = () => {
    if (confirm('Are you sure you want to clear all history?')) {
      setHistory([]);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 font-sans ${isDarkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#F8FAFC] text-slate-800'}`}>
      {/* Header */}
      <header className={`border-b px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between shadow-sm transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="bg-indigo-600 p-1.5 sm:p-2 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20">
            <GraduationCap className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
          </div>
          <div>
            <h1 className={`text-lg sm:text-xl font-bold tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>AI EXAM GRADER</h1>
            <p className={`text-[9px] sm:text-[10px] font-bold mt-1 tracking-widest uppercase ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Theoretical Assessment System</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className={`p-2 rounded-xl transition-all active:scale-95 ${isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}
            title="View History"
          >
            <History className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2 rounded-xl transition-all duration-300 ${isDarkMode ? 'bg-slate-800 text-yellow-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* History Sidebar */}
      <AnimatePresence>
        {isHistoryOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed right-0 top-0 h-full w-full max-w-md z-50 shadow-2xl flex flex-col ${isDarkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}
            >
              <div className={`p-6 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <History className="w-6 h-6 text-indigo-600" />
                  <h2 className="text-xl font-black uppercase tracking-tight">Grading History</h2>
                </div>
                <button 
                  onClick={() => setIsHistoryOpen(false)}
                  className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'}`}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                      <History className="w-8 h-8 opacity-20" />
                    </div>
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>No history yet. Start grading to see your past submissions here!</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <motion.div 
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => loadFromHistory(item)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] active:scale-95 group ${
                        isDarkMode 
                        ? 'bg-slate-800 border-slate-700 hover:border-indigo-500' 
                        : 'bg-slate-50 border-slate-100 hover:border-indigo-300 shadow-sm'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            item.score >= 7 ? 'bg-emerald-500/10 text-emerald-500' : 
                            item.score >= 4 ? 'bg-amber-500/10 text-amber-500' : 
                            'bg-rose-500/10 text-rose-500'
                          }`}>
                            Score: {item.score}/10
                          </div>
                          <span className={`text-[10px] font-medium ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                            {new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'hover:bg-slate-700 text-slate-500' : 'hover:bg-slate-200 text-slate-400'}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className={`text-xs line-clamp-2 font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                        {item.studentResponse}
                      </p>
                    </motion.div>
                  ))
                )}
              </div>

              {history.length > 0 && (
                <div className={`p-4 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                  <button 
                    onClick={clearHistory}
                    className={`w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ${
                      isDarkMode ? 'bg-slate-800 hover:bg-rose-900/40 text-rose-500' : 'bg-rose-50 hover:bg-rose-100 text-rose-600'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear All History
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="max-w-4xl mx-auto py-6 sm:py-12 px-4">
        {/* Grading Dashboard Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border shadow-xl transition-colors duration-300 overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-800 shadow-black/20' : 'bg-white border-indigo-100 shadow-indigo-500/5'}`}
        >
          {/* Card Header */}
          <div className={`p-5 sm:p-8 border-b flex items-start gap-4 sm:gap-5 transition-colors duration-300 ${isDarkMode ? 'border-slate-800' : 'border-slate-50'}`}>
            <div className={`p-2.5 sm:p-3 rounded-xl transition-colors duration-300 ${isDarkMode ? 'bg-indigo-900/30' : 'bg-indigo-50'}`}>
              <BookOpen className={`w-5 h-5 sm:w-6 sm:h-6 ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`} />
            </div>
            <div>
              <h2 className={`text-xl sm:text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Grading Dashboard</h2>
              <p className={`italic text-xs sm:text-sm mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Input the model answer and student response for analysis.</p>
            </div>
          </div>

          <div className="p-5 sm:p-8 space-y-6 sm:space-y-8">
            {/* Model Answer Section */}
            <div className="space-y-3">
              <div className="flex justify-between items-end gap-2">
                <label className={`text-xs sm:text-sm font-semibold flex items-center gap-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  Model Answer <span className={`${isDarkMode ? 'text-slate-500' : 'text-slate-400'} font-normal`}>(Reference)</span>
                </label>
                <button
                  onClick={() => setModelAnswer('')}
                  className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <textarea
                value={modelAnswer}
                onChange={(e) => setModelAnswer(e.target.value)}
                placeholder="Paste the ideal answer here..."
                className={`w-full min-h-[150px] sm:min-h-[180px] p-4 sm:p-5 rounded-2xl border-2 transition-all outline-none resize-none leading-relaxed text-sm sm:text-base ${
                  isDarkMode 
                  ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-900/20' 
                  : 'bg-white border-indigo-50 text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50'
                }`}
              />
            </div>

            {/* Student Response Section */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-2">
                <div className="flex justify-between items-end w-full sm:w-auto gap-4">
                  <label className={`text-xs sm:text-sm font-semibold flex items-center gap-2 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    Student Response <span className={`${isDarkMode ? 'text-slate-500' : 'text-slate-400'} font-normal`}>(To be graded)</span>
                  </label>
                  <button
                    onClick={() => setStudentResponse('')}
                    className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${isDarkMode ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={ocrLoading}
                  className={`flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${
                    isDarkMode 
                    ? 'bg-slate-800 hover:bg-slate-700 text-indigo-400' 
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                  }`}
                >
                  {ocrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                  Scan Handwritten Paper
                </button>
              </div>
              <textarea
                value={studentResponse}
                onChange={(e) => setStudentResponse(e.target.value)}
                placeholder="Paste the student's response here..."
                className={`w-full min-h-[150px] sm:min-h-[180px] p-4 sm:p-5 rounded-2xl border-2 transition-all outline-none resize-none leading-relaxed text-sm sm:text-base ${
                  isDarkMode 
                  ? 'bg-slate-950 border-slate-800 text-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-900/20' 
                  : 'bg-white border-slate-100 text-slate-700 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50'
                }`}
              />
              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleOCR}
                accept="image/*"
                capture="environment"
                className="hidden"
              />
            </div>

            {/* Error Message */}
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={`p-4 border rounded-xl flex items-center gap-3 text-sm ${
                  isDarkMode 
                  ? 'bg-red-900/20 border-red-900/30 text-red-400' 
                  : 'bg-red-50 border-red-100 text-red-600'
                }`}
              >
                <AlertCircle className="w-5 h-5" />
                {error}
              </motion.div>
            )}

            {/* Action Button */}
            <button
              onClick={evaluateSubmission}
              disabled={loading}
              className={`w-full py-4 sm:py-5 rounded-2xl font-black text-base sm:text-lg tracking-widest uppercase flex items-center justify-center gap-3 transition-all shadow-2xl ${
                loading 
                ? (isDarkMode ? 'bg-slate-800 text-slate-600' : 'bg-slate-100 text-slate-400') + ' cursor-not-allowed' 
                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 dark:shadow-indigo-900/20 active:scale-[0.98]'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                  Evaluating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                  Evaluate Submission
                </>
              )}
            </button>

            {/* Status Indicator */}
            {status && !error && (
              <p className={`text-center text-xs font-bold animate-pulse uppercase tracking-widest ${isDarkMode ? 'text-indigo-500' : 'text-indigo-400'}`}>{status}</p>
            )}
          </div>
        </motion.div>

        {/* Results Section */}
        <AnimatePresence>
          {score !== null && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 sm:mt-12 space-y-6"
            >
              <div 
                ref={reportRef}
                style={{ 
                  backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                  borderColor: isDarkMode ? '#1e293b' : '#e2e8f0',
                  color: isDarkMode ? '#f8fafc' : '#0f172a',
                  borderRadius: '1.5rem',
                  padding: '2.5rem',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  boxShadow: isDarkMode ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 25px 50px -12px rgba(0, 0, 0, 0.1)'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
                  <div style={{ textAlign: 'left' }}>
                    <h3 style={{ fontSize: '1.875rem', fontWeight: 900, margin: 0, color: isDarkMode ? '#ffffff' : '#0f172a' }}>Assessment Result</h3>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500, marginTop: '0.25rem', color: isDarkMode ? '#64748b' : '#94a3b8' }}>Theoretical Accuracy Analysis</p>
                  </div>
                  <div style={{ position: 'relative', width: '8rem', height: '8rem' }}>
                    <svg width="128" height="128" viewBox="0 0 128 128" style={{ transform: 'rotate(-90deg)' }}>
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke={isDarkMode ? '#1e293b' : '#f1f5f9'}
                        strokeWidth="8"
                        fill="transparent"
                      />
                      <circle
                        cx="64"
                        cy="64"
                        r="56"
                        stroke="#4f46e5"
                        strokeWidth="8"
                        fill="transparent"
                        strokeDasharray="351.8"
                        strokeDashoffset={351.8 - (351.8 * score) / 10}
                        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                      />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '2.25rem', fontWeight: 900, color: isDarkMode ? '#ffffff' : '#0f172a' }}>{score}</span>
                      <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: isDarkMode ? '#64748b' : '#94a3b8' }}>Score</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                  <div 
                    style={{ 
                      padding: '1.5rem',
                      borderRadius: '1rem',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      backgroundColor: isDarkMode ? '#020617' : '#f8fafc',
                      borderColor: isDarkMode ? '#1e293b' : '#f1f5f9'
                    }}
                  >
                    <h4 style={{ fontSize: '0.625rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem', color: isDarkMode ? '#475569' : '#94a3b8' }}>Semantic Accuracy</h4>
                    <p style={{ fontSize: '0.875rem', lineHeight: 1.625, fontStyle: 'italic', color: isDarkMode ? '#94a3b8' : '#475569' }}>
                      The submission demonstrates a <span style={{ color: '#4f46e5', fontWeight: 'bold' }}>{(score * 10).toFixed(0)}%</span> alignment with the reference model answer.
                    </p>
                  </div>
                  <div 
                    style={{ 
                      padding: '1.5rem',
                      borderRadius: '1rem',
                      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                      backgroundColor: isDarkMode ? 'rgba(49, 46, 129, 0.4)' : '#4f46e5',
                      borderWidth: isDarkMode ? '1px' : '0px',
                      borderStyle: 'solid',
                      borderColor: isDarkMode ? 'rgba(49, 46, 129, 0.5)' : 'transparent'
                    }}
                  >
                    <h4 style={{ fontSize: '0.625rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem', color: isDarkMode ? '#818cf8' : 'rgba(255, 255, 255, 0.6)' }}>AI Feedback</h4>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.625, color: isDarkMode ? '#e0e7ff' : '#ffffff' }}>
                      {feedback}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={downloadReport}
                  className={`flex-1 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 ${
                    isDarkMode 
                    ? 'bg-slate-100 hover:bg-white text-slate-900' 
                    : 'bg-slate-900 hover:bg-black text-white'
                  }`}
                >
                  <Download className="w-5 h-5" />
                  Export PDF Report
                </button>
                <button 
                  onClick={() => {
                    setScore(null);
                    setFeedback('');
                    setStudentResponse('');
                    setModelAnswer('');
                  }}
                  className={`flex-1 py-4 border rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 ${
                    isDarkMode 
                    ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-400' 
                    : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <RefreshCw className="w-5 h-5" />
                  New Assessment
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-12 text-center">
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>
          Powered by Gemini AI & SBERT Semantic Analysis
        </p>
      </footer>
    </div>
  );
}
