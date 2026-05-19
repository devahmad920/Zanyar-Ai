import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  MessageSquare, 
  BrainCircuit, 
  History, 
  Settings, 
  Sun, 
  Moon, 
  Send, 
  Plus, 
  LayoutDashboard,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sparkles,
  Menu,
  X,
  ChevronRight,
  Mic,
  MicOff,
  Camera,
  Image as ImageIcon,
  Download,
  Trash2,
  LogOut,
  LogIn,
  Video,
  Stethoscope,
  Activity,
  HeartPulse,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translations } from './translations';
import type { LanguageCode } from './translations';
import { cn } from './lib/utils';
import { askZanyar, generateQuiz, generateFlashcards } from './services/gemini';
import { generateImage as aiGenerateImage, generateVideo as aiGenerateVideo } from './services/aiGenerators';
import type { Message, QuizQuestion, Flashcard, AppState, Patient, Paramedic, UsualItem } from './types';
import Markdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import confetti from 'canvas-confetti';
import { auth, googleProvider, db } from './lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User, signInAnonymously } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  doc, 
  Timestamp 
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // Don't throw anymore to prevent crashing the whole app
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [highContrast, setHighContrast] = useState(false);
  const [language, setLanguage] = useState<LanguageCode>('ku');
  const [activeTab, setActiveTab] = useState<'home' | 'chat' | 'quiz' | 'flashcards' | 'history' | 'settings' | 'imageGen' | 'videoGen' | 'paramedicList'>('home');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // AI Generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Paramedic feature state
  const [patients, setPatients] = useState<Patient[]>([]);
  const [paramedics, setParamedics] = useState<Paramedic[]>([]);
  const [usualItems, setUsualItems] = useState<UsualItem[]>([]);
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [showAddParamedic, setShowAddParamedic] = useState(false);
  const [showAddUsualItem, setShowAddUsualItem] = useState(false);
  const [newPatient, setNewPatient] = useState({ name: '', condition: '' });
  const [newParamedic, setNewParamedic] = useState({ name: '', specialty: '' });
  const [newUsualItem, setNewUsualItem] = useState({ title: '', description: '' });

  // Quick Action Handlers
  const handleQuickSummarize = () => {
    setActiveTab('chat');
    setInput("تکایە ئەم بابەتەم بۆ پوختە بکەرەوە بە کورتی:");
  };

  const handleQuickStudyPlan = () => {
    setActiveTab('chat');
    setInput("تکایە پلانێکی خوێندنم بۆ دروست بکە بۆ ئەم بابەتە:");
  };

  // New state for voice, camera, and photos
  const [isRecording, setIsRecording] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const recognitionRef = React.useRef<any>(null);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [showQuizResult, setShowQuizResult] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  // Flashcards state
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [currentFlashcardIndex, setCurrentFlashcardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const t = translations[language];

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (curUser) => {
      if (!curUser) {
        signInAnonymously(auth).catch(e => {
          console.error("Anon login fail", e);
          setIsAuthLoading(false);
        });
      } else {
        setUser(curUser);
        setIsAuthLoading(false);
      }
    });

    // Safety timeout to prevent permanent loading hang
    const timer = setTimeout(() => {
      setIsAuthLoading(false);
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Sync Patients and Paramedics with Firestore
  useEffect(() => {
    if (!user) return;

    const patientsPath = `users/${user.uid}/patients`;
    const patientsRef = collection(db, patientsPath);
    const qPatients = query(patientsRef, orderBy('timestamp', 'desc'));
    const unsubscribePatients = onSnapshot(qPatients, (snapshot) => {
      setPatients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Patient)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, patientsPath);
    });

    const paramedicsPath = `users/${user.uid}/paramedics`;
    const paramedicsRef = collection(db, paramedicsPath);
    const qParamedics = query(paramedicsRef, orderBy('timestamp', 'desc'));
    const unsubscribeParamedics = onSnapshot(qParamedics, (snapshot) => {
      setParamedics(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Paramedic)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, paramedicsPath);
    });

    const usualItemsPath = `users/${user.uid}/usualItems`;
    const usualItemsRef = collection(db, usualItemsPath);
    const qUsualItems = query(usualItemsRef, orderBy('timestamp', 'desc'));
    const unsubscribeUsualItems = onSnapshot(qUsualItems, (snapshot) => {
      setUsualItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UsualItem)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, usualItemsPath);
    });

    return () => {
      unsubscribePatients();
      unsubscribeParamedics();
      unsubscribeUsualItems();
    };
  }, [user]);

  const handleAddPatient = async () => {
    if (!user || !newPatient.name.trim()) return;
    const path = `users/${user.uid}/patients`;
    try {
      await addDoc(collection(db, path), {
        ...newPatient,
        timestamp: Date.now()
      });
      setNewPatient({ name: '', condition: '' });
      setShowAddPatient(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleAddParamedic = async () => {
    if (!user || !newParamedic.name.trim()) return;
    const path = `users/${user.uid}/paramedics`;
    try {
      await addDoc(collection(db, path), {
        ...newParamedic,
        timestamp: Date.now()
      });
      setNewParamedic({ name: '', specialty: '' });
      setShowAddParamedic(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const deletePatient = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/patients/${id}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/patients`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const deleteParamedic = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/paramedics/${id}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/paramedics`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleAddUsualItem = async () => {
    if (!user || !newUsualItem.title.trim()) return;
    const path = `users/${user.uid}/usualItems`;
    try {
      await addDoc(collection(db, path), {
        ...newUsualItem,
        timestamp: Date.now()
      });
      setNewUsualItem({ title: '', description: '' });
      setShowAddUsualItem(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const deleteUsualItem = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/usualItems/${id}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/usualItems`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleLogin = async () => {};
  const handleGuestLogin = async () => {};
  const handleLogout = async () => {
    setMessages([]);
    setActiveTab('home');
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking, activeTab]);

  useEffect(() => {
    // Direction setup
    const dir = ['ku', 'ar', 'fa'].includes(language) ? 'rtl' : 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
    // Initial welcome message
    if (messages.length === 0) {
      setMessages([{
        id: '1',
        role: 'assistant',
        content: t.welcomeMessage,
        timestamp: Date.now()
      }]);
    }
    
    // Theme setup
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // High Contrast setup
    if (highContrast) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }

    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'ku-IQ'; // Try Kurdish IQ, or default to system

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsRecording(false);
      };

      recognitionRef.current.onerror = () => setIsRecording(false);
      recognitionRef.current.onend = () => setIsRecording(false);
    }
  }, [theme, language, highContrast]);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setShowCamera(true);
      }
    } catch (error) {
      console.error("Camera access error:", error);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg');
      setSelectedImage(dataUrl);
      stopCamera();
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setShowCamera(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const exportChatToPDF = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica");
    doc.text("Zanyar AI Study History", 10, 10);
    
    let y = 20;
    messages.forEach(msg => {
      const role = msg.role === 'user' ? 'بەکارھێنەر' : 'زانیار AI';
      const text = `${role}: ${msg.content.substring(0, 50)}...`;
      doc.text(text, 10, y);
      y += 10;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    });

    doc.save('zanyar-study-history.pdf');
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && !selectedImage) || isThinking) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input || (selectedImage ? "[وێنە نێردرا]" : ""),
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsThinking(true);

    try {
      const history = messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));
      
      let imagePart;
      if (selectedImage) {
        const base64Data = selectedImage.split(',')[1];
        imagePart = {
          inlineData: {
            data: base64Data,
            mimeType: "image/jpeg"
          }
        };
        setSelectedImage(null);
      }

      const response = await askZanyar(input, history, imagePart);
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t.error,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!input.trim() || isThinking) return;
    setIsThinking(true);
    setActiveTab('quiz');
    
    try {
      const response = await generateQuiz(input);
      // Simple parser for the [QUIZ] format
      const questions: QuizQuestion[] = [];
      const regex = /\[QUIZ\]\s*Question:\s*(.*?)\s*Options:\s*a\)\s*(.*?)\s*b\)\s*(.*?)\s*c\)\s*(.*?)\s*d\)\s*(.*?)\s*Answer:\s*([abcd])\s*Explanation:\s*(.*?)\s*\[\/QUIZ\]/gs;
      
      let match;
      while ((match = regex.exec(response)) !== null) {
        questions.push({
          id: Math.random().toString(),
          question: match[1].trim(),
          options: [match[2].trim(), match[3].trim(), match[4].trim(), match[5].trim()],
          correctAnswer: match[6].toLowerCase().charCodeAt(0) - 97, // a=0, b=1...
          explanation: match[7].trim()
        });
      }
      
      if (questions.length > 0) {
        setQuizQuestions(questions);
        setCurrentQuizIndex(0);
        setQuizScore(0);
        setShowQuizResult(false);
        setSelectedOption(null);
      } else {
        // Fallback or show error
        console.error("Failed to parse quiz questions");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsThinking(false);
    }
  };

  const handleGenerateFlashcards = async () => {
    if (!input.trim() || isThinking) return;
    setIsThinking(true);
    setActiveTab('flashcards');
    
    try {
      const response = await generateFlashcards(input);
      // Simple parser for flashcards
      const cards: Flashcard[] = [];
      const blocks = response.split('---');
      
      blocks.forEach(block => {
        const frontMatch = block.match(/Front:\s*(.*)/);
        const backMatch = block.match(/Back:\s*(.*)/);
        
        if (frontMatch && backMatch) {
          cards.push({
            id: Math.random().toString(),
            front: frontMatch[1].trim(),
            back: backMatch[1].trim(),
            category: input
          });
        }
      });
      
      if (cards.length > 0) {
        setFlashcards(cards);
        setCurrentFlashcardIndex(0);
        setIsFlipped(false);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsThinking(false);
    }
  };

  const ensureApiKeySelection = async () => {
    // @ts-ignore
    if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
    }
    return true;
  };

  const handleStartImageGen = async () => {
    if (!aiPrompt.trim() || isGenerating) return;
    
    await ensureApiKeySelection();
    
    setIsGenerating(true);
    setGeneratedImage(null);
    setGenerationStatus("Generating image...");
    try {
      const imageUrl = await aiGenerateImage(aiPrompt);
      setGeneratedImage(imageUrl);
    } catch (error) {
      console.error(error);
      if (error instanceof Error && (error.message.includes("Requested entity was not found") || error.message.includes("PERMISSION_DENIED") || error.message.includes("403"))) {
        // @ts-ignore
        if (window.aistudio) await window.aistudio.openSelectKey();
      }
    } finally {
      setIsGenerating(false);
      setGenerationStatus("");
    }
  };

  const handleStartVideoGen = async () => {
    if (!aiPrompt.trim() || isGenerating) return;
    
    await ensureApiKeySelection();
    
    setIsGenerating(true);
    setGeneratedVideoUrl(null);
    setGenerationStatus("Initializing video generation...");
    try {
      const videoUrl = await aiGenerateVideo(aiPrompt, (status) => {
        setGenerationStatus(status);
      });
      setGeneratedVideoUrl(videoUrl);
    } catch (error) {
       console.error(error);
       if (error instanceof Error && (error.message.includes("Requested entity was not found") || error.message.includes("PERMISSION_DENIED") || error.message.includes("403"))) {
        // @ts-ignore
        if (window.aistudio) await window.aistudio.openSelectKey();
      }
    } finally {
       setIsGenerating(false);
       setGenerationStatus("");
    }
  };

  const menuItems = [
    { id: 'home', icon: LayoutDashboard, label: t.home || "سەرەتا" },
    { id: 'chat', icon: MessageSquare, label: t.studyAssistant },
    { id: 'quiz', icon: BrainCircuit, label: t.quizMode },
    { id: 'flashcards', icon: BookOpen, label: t.flashcards },
    { id: 'imageGen', icon: ImageIcon, label: t.imageGenerator },
    { id: 'videoGen', icon: Video, label: t.videoGenerator },
    { id: 'paramedicList', icon: HeartPulse, label: t.paramedicList },
    { id: 'history', icon: History, label: t.history },
    { id: 'settings', icon: Settings, label: t.settings },
  ];

  if (isAuthLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Sparkles className="w-12 h-12 text-primary" />
        </motion.div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300 font-sans" dir={['ku', 'ar', 'fa'].includes(language) ? 'rtl' : 'ltr'}>
      {/* Mobile Header */}
      <header className="lg:hidden flex items-center justify-between p-4 border-b bg-card sticky top-0 z-50">
        <button onClick={() => setIsSidebarOpen(true)} className="p-2 hover:bg-muted rounded-lg transition-colors">
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary fill-primary/20" />
          <h1 className="text-xl font-bold font-kurdish leading-none mt-1">{t.appName}</h1>
        </div>
        <button 
          onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')} 
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </button>
      </header>

      <div className="flex h-[calc(100vh-65px)] lg:h-screen overflow-hidden">
        {/* Sidebar (Desktop) */}
        <aside className={cn(
          "fixed inset-y-0 right-0 z-50 w-64 bg-card border-l transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
          !isSidebarOpen && "translate-x-full lg:translate-x-0"
        )}>
          <div className="flex flex-col h-full">
            <div className="p-6 hidden lg:flex items-center gap-3 border-b mb-4">
              <div className="p-2 bg-primary/10 rounded-xl">
               <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h1 className="text-2xl font-bold font-kurdish">{t.appName}</h1>
            </div>
            
            <div className="lg:hidden p-4 flex justify-between items-center border-b mb-4">
               <span className="font-bold text-lg">{t.appName}</span>
               <button onClick={() => setIsSidebarOpen(false)}><X className="w-6 h-6" /></button>
            </div>

            <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-kurdish",
                    activeTab === item.id 
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="p-4 border-t space-y-4">
               <button 
                onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted rounded-xl hover:bg-muted/80 transition-colors"
               >
                 <div className="flex items-center gap-3">
                   {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                   <span className="font-kurdish">{theme === 'light' ? t.darkMode : t.lightMode}</span>
                 </div>
                 <div className={cn(
                   "w-10 h-5 rounded-full p-1 transition-colors duration-300",
                   theme === 'dark' ? "bg-primary" : "bg-slate-300"
                 )}>
                   <div className={cn(
                     "w-3 h-3 bg-white rounded-full transition-transform duration-300",
                     theme === 'dark' ? "-translate-x-5" : "translate-x-0"
                   )} />
                 </div>
               </button>
               
                <div className="flex items-center gap-2 p-2 px-1">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shadow-inner overflow-hidden">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-bold truncate">{(language === 'ku' ? 'میوان' : 'Guest')}</span>
                  </div>
                </div>
            </div>
          </div>
        </aside>

        {/* Backdrop for mobile */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-hidden flex flex-col bg-background/50 backdrop-blur-3xl">
          <AnimatePresence mode="wait">
            {activeTab === 'home' && (
              <motion.div 
                key="home"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex-1 overflow-y-auto p-6 md:p-10"
              >
                <div className="max-w-6xl mx-auto">
                  <header className="mb-12">
                    <motion.h2 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-4xl md:text-5xl font-black font-kurdish mb-4 tracking-tight"
                    >
                      {t.goodDay} 👋

                    </motion.h2>
                    <p className="text-xl text-muted-foreground font-kurdish">
                      {t.readyToLearn}
                    </p>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <motion.div 
                      whileHover={{ y: -5 }}
                      onClick={() => setActiveTab('chat')}
                      className="md:col-span-2 bg-primary p-8 rounded-[2rem] text-primary-foreground shadow-2xl shadow-primary/30 cursor-pointer relative overflow-hidden group"
                    >
                      <div className="relative z-10">
                        <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md">
                          <MessageSquare className="w-8 h-8" />
                        </div>
                        <h3 className="text-3xl font-bold font-kurdish mb-3">{t.studyAssistant}</h3>
                        <p className="text-primary-foreground/80 font-kurdish text-lg max-w-md">
                          {t.assistantDesc}
                        </p>
                      </div>
                      <Sparkles className="absolute -bottom-10 -right-10 w-64 h-64 text-white/5 rotate-12 group-hover:scale-110 transition-transform duration-700" />
                    </motion.div>

                    <div className="grid grid-rows-2 gap-6">
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        onClick={handleQuickSummarize}
                        className="bg-card border p-6 rounded-[2rem] shadow-xl cursor-pointer hover:border-primary transition-all flex flex-col justify-between"
                      >
                         <div className="bg-amber-100 dark:bg-amber-900/30 w-12 h-12 rounded-xl flex items-center justify-center text-amber-600">
                           <BookOpen className="w-6 h-6" />
                         </div>
                         <div>
                           <h4 className="text-xl font-bold font-kurdish">{t.summarizeTool}</h4>
                           <p className="text-sm text-muted-foreground font-kurdish">{t.summarizeQuick}</p>
                         </div>
                      </motion.div>
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        onClick={handleQuickStudyPlan}
                        className="bg-card border p-6 rounded-[2rem] shadow-xl cursor-pointer hover:border-primary transition-all flex flex-col justify-between"
                      >
                         <div className="bg-emerald-100 dark:bg-emerald-900/30 w-12 h-12 rounded-xl flex items-center justify-center text-emerald-600">
                           <LayoutDashboard className="w-6 h-6" />
                         </div>
                         <div>
                           <h4 className="text-xl font-bold font-kurdish">{t.studyPlanner}</h4>
                           <p className="text-sm text-muted-foreground font-kurdish">{t.studyPlanQuick}</p>
                         </div>
                      </motion.div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setActiveTab('imageGen')}
                      className="bg-card border p-8 rounded-[2rem] shadow-xl cursor-pointer hover:border-primary transition-all flex items-center gap-6"
                    >
                       <div className="bg-purple-100 dark:bg-purple-900/30 w-16 h-16 rounded-2xl flex items-center justify-center text-purple-600 shrink-0">
                         <ImageIcon className="w-8 h-8" />
                       </div>
                       <div>
                         <h4 className="text-2xl font-bold font-kurdish mb-1">{t.imageGenerator}</h4>
                         <p className="text-muted-foreground font-kurdish">{t.imageGenDesc}</p>
                       </div>
                    </motion.div>
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setActiveTab('videoGen')}
                      className="bg-card border p-8 rounded-[2rem] shadow-xl cursor-pointer hover:border-primary transition-all flex items-center gap-6"
                    >
                       <div className="bg-indigo-100 dark:bg-indigo-900/30 w-16 h-16 rounded-2xl flex items-center justify-center text-indigo-600 shrink-0">
                         <Video className="w-8 h-8" />
                       </div>
                       <div>
                         <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-2xl font-bold font-kurdish">{t.videoGenerator}</h4>
                         </div>
                         <p className="text-muted-foreground font-kurdish">{t.videoGenDesc}</p>
                       </div>
                    </motion.div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setActiveTab('paramedicList')}
                      className="bg-card border p-8 rounded-[2rem] shadow-xl cursor-pointer hover:border-red-500 transition-all flex items-center gap-6"
                    >
                       <div className="bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-2xl flex items-center justify-center text-red-600 shrink-0">
                         <HeartPulse className="w-8 h-8" />
                       </div>
                       <div>
                         <h4 className="text-2xl font-bold font-kurdish mb-1">{t.paramedicList}</h4>
                         <p className="text-muted-foreground font-kurdish">{t.paramedicDesc}</p>
                       </div>
                    </motion.div>
                    <motion.div 
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setActiveTab('paramedicList')} // It's actually the same tab currently, or I should have a separate tab for usual list? 
                      // Wait, I put them both in the 'paramedicList' tab in the code. 
                      // Let's re-check the Tab display logic for paramedicList
                      className="bg-card border p-8 rounded-[2rem] shadow-xl cursor-pointer hover:border-emerald-500 transition-all flex items-center gap-6"
                    >
                       <div className="bg-emerald-100 dark:bg-emerald-900/30 w-16 h-16 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
                         <CheckCircle2 className="w-8 h-8" />
                       </div>
                       <div>
                         <h4 className="text-2xl font-bold font-kurdish mb-1">{t.usualList}</h4>
                         <p className="text-muted-foreground font-kurdish">{t.usualDesc}</p>
                       </div>
                    </motion.div>
                  </div>

                  {/* Study Tip Card */}
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-secondary/50 p-8 rounded-[2rem] border-2 border-dashed border-primary/20 mb-12 flex flex-col md:flex-row items-center gap-8 shadow-inner"
                  >
                    <div className="bg-primary/20 p-4 rounded-full">
                       <HelpCircle className="w-12 h-12 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-xl font-bold font-kurdish mb-2">{t.pomodoroTitle}</h4>
                      <p className="text-muted-foreground font-kurdish leading-relaxed">
                        {t.pomodoroTip}
                      </p>
                    </div>
                  </motion.div>

                  <section>
                    <h3 className="text-2xl font-bold font-kurdish mb-6 flex items-center gap-3">
                       <History className="w-6 h-6 text-primary" />
                       {t.recentActivity}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[1, 2, 3, 4].map((i) => (
                        <motion.div 
                          key={i}
                          whileHover={{ y: -3 }}
                          className="p-5 bg-card border rounded-3xl hover:shadow-lg transition-all"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
                              <BrainCircuit className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-[10px] text-muted-foreground font-bold">{i} {t.daysAgo}</span>
                          </div>
                          <h5 className="font-bold font-kurdish mb-1">{t.quiz} {i}</h5>
                          <p className="text-xs text-muted-foreground font-kurdish">{t.score}: ٤ {language === 'ku' ? 'لە' : 'of'} ٥</p>
                        </motion.div>
                      ))}
                    </div>
                  </section>
                </div>
              </motion.div>
            )}

            {activeTab === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full p-4 md:p-6"
              >
                <div className="flex-1 overflow-y-auto space-y-6 pb-24 scrollbar-hide" ref={scrollRef}>
                  {messages.map((msg) => (
                    <motion.div 
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "flex w-full mb-4",
                        msg.role === 'user' ? "justify-start" : "justify-end"
                      )}
                    >
                      <motion.div 
                        whileHover={{ scale: 1.01 }}
                        className={cn(
                          "max-w-[85%] p-4 md:p-5 rounded-2xl shadow-sm relative group break-words",
                          msg.role === 'user' 
                            ? "bg-primary text-white rounded-tr-none" 
                            : "bg-card border rounded-tl-none"
                        )}
                      >
                        <div className={cn(
                          "prose prose-sm md:prose-base dark:prose-invert font-kurdish leading-relaxed max-w-full",
                          msg.role === 'user' ? "[&_*]:text-white text-white" : "text-foreground"
                        )}>
                          <Markdown>{msg.content}</Markdown>
                        </div>
                        <div className={cn(
                          "text-[10px] mt-2 opacity-60 flex items-center gap-1",
                          msg.role === 'user' ? "text-white/80" : "text-muted-foreground"
                        )}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </motion.div>
                    </motion.div>
                  ))}
                  {isThinking && (
                    <div className="flex justify-start w-full">
                      <div className="bg-card border p-4 rounded-2xl rounded-tr-none flex items-center gap-2">
                        <div className="flex space-x-1 rtl:space-x-reverse">
                          <motion.div 
                            animate={{ scale: [1, 1.2, 1] }} 
                            transition={{ repeat: Infinity, duration: 1 }}
                            className="w-2 h-2 bg-primary rounded-full" 
                          />
                          <motion.div 
                            animate={{ scale: [1, 1.2, 1] }} 
                            transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                            className="w-2 h-2 bg-primary rounded-full" 
                          />
                          <motion.div 
                            animate={{ scale: [1, 1.2, 1] }} 
                            transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                            className="w-2 h-2 bg-primary rounded-full" 
                          />
                        </div>
                        <span className="text-xs text-muted-foreground font-kurdish">{t.thinking}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Floating Clear Chat Button */}
                <button 
                  onClick={() => setMessages([{ id: '1', role: 'assistant', content: t.welcomeMessage, timestamp: Date.now() }])}
                  className="absolute top-4 left-4 bg-muted/80 backdrop-blur-md p-2 rounded-lg hover:bg-destructive hover:text-white transition-all text-muted-foreground shadow-sm"
                  title="Clear Chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                {/* Input Area */}
                <div className="absolute bottom-6 left-4 right-4 max-w-4xl mx-auto">
                  <div className="bg-card border rounded-2xl shadow-2xl p-2 flex flex-col gap-2 focus-within:ring-2 ring-primary/20 transition-all">
                    {selectedImage && (
                      <div className="px-4 pt-2 relative">
                        <img src={selectedImage} alt="Selected" className="h-20 w-20 object-cover rounded-lg border" />
                        <button 
                          onClick={() => setSelectedImage(null)}
                          className="absolute top-0 right-14 bg-destructive text-white rounded-full p-1 shadow-lg"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    
                    <div className="flex items-end gap-2">
                       <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={t.askAnything}
                        rows={1}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-3 px-4 min-h-[50px] max-h-[200px] font-kurdish text-lg"
                      />
                      <div className="flex items-center gap-1 pb-1 pr-1 rtl:pl-1 rtl:pr-0">
                        <button 
                          onClick={toggleRecording}
                          title="Voice Input"
                          className={cn(
                            "p-3 rounded-xl transition-all duration-300",
                            isRecording ? "bg-destructive text-white animate-pulse" : "text-primary hover:bg-primary/10"
                          )}
                        >
                          {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        </button>
                        
                        <div className="relative group/photo">
                          <button 
                            onClick={startCamera}
                            className="p-3 text-primary hover:bg-primary/10 rounded-xl transition-colors"
                          >
                            <Camera className="w-6 h-6" />
                          </button>
                        </div>

                        <label className="p-3 text-primary hover:bg-primary/10 rounded-xl transition-colors cursor-pointer">
                          <ImageIcon className="w-6 h-6" />
                          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                        </label>

                        <button 
                          onClick={handleGenerateQuiz}
                          title={t.generateQuiz}
                          className="p-3 text-primary hover:bg-primary/10 rounded-xl transition-colors"
                        >
                          <BrainCircuit className="w-6 h-6" />
                        </button>
                        
                        <motion.button 
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={handleSendMessage}
                          disabled={isThinking || (!input.trim() && !selectedImage)}
                          className="p-3 bg-primary text-primary-foreground rounded-xl hover:shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
                        >
                          <Send className="w-6 h-6" />
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Camera Modal */}
                {showCamera && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                    <div className="bg-card rounded-3xl overflow-hidden max-w-lg w-full shadow-2xl relative">
                      <video ref={videoRef} autoPlay playsInline className="w-full aspect-video bg-black" />
                      <div className="p-6 flex justify-center gap-6">
                        <button 
                          onClick={capturePhoto}
                          className="p-4 bg-primary text-white rounded-full shadow-xl hover:scale-110 transition-transform"
                        >
                          <Camera className="w-8 h-8" />
                        </button>
                        <button 
                          onClick={stopCamera}
                          className="p-4 bg-muted text-foreground rounded-full shadow-xl"
                        >
                          <X className="w-8 h-8" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'quiz' && (
              <motion.div 
                key="quiz"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex-1 flex flex-col items-center justify-center p-6 max-w-3xl mx-auto w-full"
              >
                {quizQuestions.length > 0 ? (
                  !showQuizResult ? (
                    <div className="bg-card border p-8 rounded-3xl shadow-xl w-full">
                      <div className="flex justify-between items-center mb-8">
                        <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-bold">
                          {currentQuizIndex + 1} / {quizQuestions.length}
                        </span>
                        <h2 className="text-xl font-bold font-kurdish">{t.quizMode}</h2>
                      </div>
                      
                      <p className="text-xl md:text-2xl font-bold mb-8 font-kurdish leading-relaxed">
                        {quizQuestions[currentQuizIndex].question}
                      </p>
                      
                      <div className="grid gap-4">
                        {quizQuestions[currentQuizIndex].options.map((option, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSelectedOption(idx)}
                            className={cn(
                              "text-right p-5 rounded-2xl border-2 transition-all duration-200 text-lg font-kurdish flex items-center justify-between gap-4",
                              selectedOption === idx 
                                ? "border-primary bg-primary/5 shadow-md" 
                                : "hover:border-primary/50 hover:bg-muted/50 border-border"
                            )}
                          >
                             <span className="flex-1">{option}</span>
                             <div className={cn(
                               "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
                               selectedOption === idx ? "border-primary bg-primary" : "border-muted-foreground"
                             )}>
                               {selectedOption === idx && <div className="w-2 h-2 bg-white rounded-full" />}
                             </div>
                          </button>
                        ))}
                      </div>

                      <div className="mt-10 flex justify-between items-center">
                        <button 
                          onClick={() => {
                            if (selectedOption === null) return;
                            if (selectedOption === quizQuestions[currentQuizIndex].correctAnswer) {
                              setQuizScore(prev => prev + 1);
                              confetti({
                                particleCount: 100,
                                spread: 70,
                                origin: { y: 0.6 },
                                colors: ['#3b82f6', '#ffffff']
                              });
                            }
                            
                            if (currentQuizIndex + 1 < quizQuestions.length) {
                              setCurrentQuizIndex(prev => prev + 1);
                              setSelectedOption(null);
                            } else {
                              setShowQuizResult(true);
                            }
                          }}
                          disabled={selectedOption === null}
                          className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold font-kurdish text-lg disabled:opacity-50 shadow-lg shadow-primary/25 active:scale-[0.98] transition-transform"
                        >
                          {currentQuizIndex + 1 === quizQuestions.length ? t.finishQuiz : t.nextQuestion}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-card border p-12 rounded-3xl shadow-xl w-full text-center">
                      <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Sparkles className="w-12 h-12 text-primary" />
                      </div>
                      <h2 className="text-3xl font-bold mb-4 font-kurdish">کۆتایی دەستەکە!</h2>
                      <p className="text-lg text-muted-foreground mb-8 font-kurdish">نمرەکەت بۆ ئەم کویزە:</p>
                      <div className="text-6xl font-black text-primary mb-12">
                        {quizScore} / {quizQuestions.length}
                      </div>
                      <div className="flex flex-col gap-3">
                        <button 
                          onClick={() => setQuizQuestions([])}
                          className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-bold font-kurdish text-lg"
                        >
                          گەڕانەوە بۆ چات
                        </button>
                        <button 
                          onClick={() => {
                            const doc = new jsPDF();
                            doc.text(`Quiz Results: ${quizScore}/${quizQuestions.length}`, 10, 10);
                            quizQuestions.forEach((q, i) => {
                              doc.text(`${i+1}. ${q.question}`, 10, 20 + (i*20));
                            });
                            doc.save('quiz-result.pdf');
                          }}
                          className="w-full py-4 bg-muted text-foreground border rounded-2xl font-bold font-kurdish text-lg flex items-center justify-center gap-2"
                        >
                          <Download className="w-5 h-5" /> دابەزاندنی PDF
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="text-center space-y-6">
                    <div className="bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
                      <BrainCircuit className="w-10 h-10 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold font-kurdish">{t.quizMode}</h2>
                    <p className="text-muted-foreground font-kurdish max-w-xs mx-auto">
                      بابەتێک لە چاتدا بنووسە و دوگمەی کویز دابگرە بۆ ئەوەی زانیار AI کویزێکت بۆ دروست بکات.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'flashcards' && (
              <motion.div 
                key="flashcards"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex-1 flex flex-col items-center justify-center p-6 w-full max-w-2xl mx-auto"
              >
                {flashcards.length > 0 ? (
                  <div className="w-full space-y-8">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-sm font-bold text-muted-foreground">
                        {currentFlashcardIndex + 1} / {flashcards.length}
                      </span>
                      <h2 className="text-xl font-bold font-kurdish">{t.flashcards}</h2>
                    </div>

                    <div 
                      className="perspective-1000 h-96 w-full cursor-pointer"
                      onClick={() => setIsFlipped(!isFlipped)}
                    >
                      <motion.div 
                        initial={false}
                        animate={{ rotateY: isFlipped ? 180 : 0 }}
                        transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
                        className="relative w-full h-full preserve-3d"
                      >
                        {/* Front */}
                        <div className="absolute inset-0 backface-hidden bg-card border-2 border-primary/20 rounded-3xl shadow-xl flex items-center justify-center p-10 text-center">
                          <p className="text-2xl md:text-3xl font-bold font-kurdish leading-relaxed">
                            {flashcards[currentFlashcardIndex].front}
                          </p>
                          <div className="absolute bottom-6 text-xs text-muted-foreground flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> کلیک بکە بۆ بینینی وەڵام
                          </div>
                        </div>

                        {/* Back */}
                        <div 
                          className="absolute inset-0 backface-hidden bg-primary text-primary-foreground rounded-3xl shadow-xl flex items-center justify-center p-10 text-center"
                          style={{ transform: 'rotateY(180deg)' }}
                        >
                          <p className="text-xl md:text-2xl font-medium font-kurdish leading-relaxed">
                            {flashcards[currentFlashcardIndex].back}
                          </p>
                        </div>
                      </motion.div>
                    </div>

                    <div className="flex gap-4">
                      <button 
                        onClick={() => {
                          setIsFlipped(false);
                          setCurrentFlashcardIndex(prev => (prev + 1) % flashcards.length);
                        }}
                        className="flex-1 py-4 bg-primary/10 text-primary border border-primary/20 rounded-2xl font-bold font-kurdish hover:bg-primary/20 transition-colors"
                      >
                        {t.next}
                      </button>
                      <button 
                        onClick={() => setFlashcards([])}
                        className="px-6 py-4 bg-muted rounded-2xl hover:bg-muted/80 transition-colors"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-6">
                    <div className="bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
                      <BookOpen className="w-10 h-10 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold font-kurdish">{t.flashcards}</h2>
                    <p className="text-muted-foreground font-kurdish max-w-xs mx-auto">
                      {t.flashcardHelp}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
            
             {activeTab === 'imageGen' && (
              <motion.div 
                key="imageGen"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 overflow-y-auto p-6 md:p-10"
              >
                <div className="max-w-4xl mx-auto">
                  <header className="mb-10 flex items-center justify-between">
                    <div>
                      <h2 className="text-3xl font-bold font-kurdish mb-2">{t.imageGenerator}</h2>
                      <p className="text-muted-foreground font-kurdish">{t.imageGenDesc}</p>
                    </div>
                    <button onClick={() => setActiveTab('home')} className="p-3 bg-muted rounded-2xl hover:bg-muted/80 transition-colors">
                      <X className="w-6 h-6" />
                    </button>
                  </header>

                  <div className="bg-card border rounded-[2rem] p-8 shadow-xl mb-8">
                    <div className="flex flex-col gap-6">
                      <textarea 
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={t.promptPlaceholder}
                        className="w-full bg-muted/50 border-none rounded-2xl p-6 min-h-[150px] font-kurdish text-lg focus:ring-2 ring-primary/20 transition-all resize-none"
                      />
                      <button 
                        onClick={handleStartImageGen}
                        disabled={isGenerating || !aiPrompt.trim()}
                        className={cn(
                          "w-full py-5 rounded-2xl font-bold text-xl transition-all flex items-center justify-center gap-3",
                          isGenerating || !aiPrompt.trim() 
                            ? "bg-muted text-muted-foreground cursor-not-allowed" 
                            : "bg-primary text-primary-foreground hover:shadow-xl hover:shadow-primary/20 active:scale-95"
                        )}
                      >
                        {isGenerating ? <Sparkles className="w-6 h-6 animate-spin" /> : <ImageIcon className="w-6 h-6" />}
                        <span>{isGenerating ? generationStatus || t.generating : t.generateImage}</span>
                      </button>
                    </div>
                  </div>

                  {generatedImage && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-card border rounded-[2rem] p-4 shadow-2xl relative group"
                    >
                      <img 
                        src={generatedImage} 
                        alt="Generated" 
                        className="w-full h-auto rounded-2xl" 
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-8 right-8 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <a 
                          href={generatedImage} 
                          download="zanyar-image.png"
                          className="p-3 bg-white/20 backdrop-blur-md rounded-xl text-white hover:bg-white/40 transition-colors"
                         >
                           <Download className="w-6 h-6" />
                         </a>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'videoGen' && (
              <motion.div 
                key="videoGen"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 overflow-y-auto p-6 md:p-10"
              >
                <div className="max-w-4xl mx-auto">
                  <header className="mb-10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-3xl font-bold font-kurdish">{t.videoGenerator}</h2>
                    </div>
                    <button onClick={() => setActiveTab('home')} className="p-3 bg-muted rounded-2xl hover:bg-muted/80 transition-colors">
                      <X className="w-6 h-6" />
                    </button>
                  </header>

                   <div className="bg-card border rounded-[2rem] p-8 shadow-xl mb-8">
                    <div className="flex flex-col gap-6">
                      <textarea 
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={t.promptPlaceholder}
                        className="w-full bg-muted/50 border-none rounded-2xl p-6 min-h-[150px] font-kurdish text-lg focus:ring-2 ring-primary/20 transition-all resize-none"
                      />
                      <button 
                        onClick={handleStartVideoGen}
                        disabled={isGenerating || !aiPrompt.trim()}
                        className={cn(
                          "w-full py-5 rounded-2xl font-bold text-xl transition-all flex items-center justify-center gap-3",
                          isGenerating || !aiPrompt.trim() 
                            ? "bg-muted text-muted-foreground cursor-not-allowed" 
                            : "bg-primary text-primary-foreground hover:shadow-xl hover:shadow-primary/20 active:scale-95"
                        )}
                      >
                        {isGenerating ? <Sparkles className="w-6 h-6 animate-pulse" /> : <Video className="w-6 h-6" />}
                        <span>{isGenerating ? generationStatus || t.generating : t.generateVideo}</span>
                      </button>
                    </div>
                  </div>

                  {generatedVideoUrl && (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-card border rounded-[2rem] p-4 shadow-2xl overflow-hidden"
                    >
                      <video 
                        src={generatedVideoUrl} 
                        controls 
                        className="w-full h-auto rounded-2xl"
                      />
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 p-6 overflow-y-auto w-full max-w-4xl mx-auto"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold font-kurdish flex items-center gap-3">
                    <History className="w-7 h-7 text-primary" />
                    {t.history}
                  </h2>
                  <button 
                    onClick={exportChatToPDF}
                    className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-xl font-medium hover:bg-primary/20 transition-colors"
                  >
                    <Download className="w-5 h-5" /> {t.generateQuiz} (PDF)
                  </button>
                </div>
                <div className="grid gap-4">
                  <div className="p-4 bg-card border rounded-2xl hover:border-primary transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="font-bold text-lg font-kurdish group-hover:text-primary transition-colors line-clamp-1">{language === 'ku' ? 'زانستی سروشتی: بەشی یەکەم' : 'Natural Science: Part 1'}</h3>
                       <span className="text-xs text-muted-foreground whitespace-nowrap">2 {t.hoursAgo}</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-kurdish line-clamp-2">{language === 'ku' ? 'کورتەیەک لەسەر سیستمە ژینگەییەکان و جۆرەکانی...' : 'A summary of ecosystems and their types...'}</p>
                  </div>
                  <div className="p-4 bg-card border rounded-2xl hover:border-primary transition-colors cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                       <h3 className="font-bold text-lg font-kurdish group-hover:text-primary transition-colors line-clamp-1">{language === 'ku' ? 'بیرکاری: هاوکێشەی دووجا' : 'Math: Quadratic Equations'}</h3>
                       <span className="text-xs text-muted-foreground whitespace-nowrap">{t.yesterday}</span>
                    </div>
                    <p className="text-sm text-muted-foreground font-kurdish line-clamp-2">{language === 'ku' ? 'چۆنێتی چارەسەرکردنی هاوکێشەی پلە دوو..' : 'How to solve second-degree equations...'}</p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'paramedicList' && (
              <motion.div 
                key="paramedicList"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="flex-1 overflow-y-auto p-6 md:p-10"
              >
                <div className="max-w-5xl mx-auto">
                  <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-bold font-kurdish mb-2">{t.paramedicList}</h2>
                      <p className="text-muted-foreground font-kurdish">{t.paramedicDesc}</p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setShowAddPatient(true)}
                        className="flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-2xl font-bold hover:shadow-lg transition-all active:scale-95"
                       >
                         <Plus className="w-5 h-5" />
                         <span className="font-kurdish">{t.addPatient}</span>
                       </button>
                       <button 
                        onClick={() => setShowAddParamedic(true)}
                        className="flex items-center gap-2 px-4 py-3 bg-secondary text-secondary-foreground rounded-2xl font-bold hover:shadow-lg transition-all active:scale-95 border"
                       >
                         <Plus className="w-5 h-5" />
                         <span className="font-kurdish">{t.addParamedic}</span>
                       </button>
                       <button 
                        onClick={() => setShowAddUsualItem(true)}
                        className="flex items-center gap-2 px-4 py-3 bg-muted text-foreground rounded-2xl font-bold hover:shadow-lg transition-all active:scale-95 border"
                       >
                         <Plus className="w-5 h-5" />
                         <span className="font-kurdish">{t.addItem}</span>
                       </button>
                    </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                    {/* Patients Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3 border-b-2 border-primary pb-2 font-kurdish">
                        <Activity className="w-6 h-6 text-primary" />
                        <h3 className="text-xl font-bold">{t.patients}</h3>
                        <span className="ml-auto bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">{patients.length}</span>
                      </div>
                      <div className="space-y-4">
                        {patients.map((patient) => (
                          <motion.div 
                            key={patient.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-card border p-5 rounded-3xl group shadow-sm hover:shadow-md transition-all border-l-4 border-l-primary"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="font-bold text-lg font-kurdish">{patient.name}</h4>
                                <p className="text-muted-foreground font-kurdish mt-1 whitespace-pre-wrap">{patient.condition}</p>
                                <span className="text-[10px] text-muted-foreground mt-2 block">
                                  {new Date(patient.timestamp).toLocaleString()}
                                </span>
                              </div>
                              <button 
                                onClick={() => deletePatient(patient.id)}
                                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                        {patients.length === 0 && (
                          <div className="text-center py-10 opacity-30">
                            <Activity className="w-12 h-12 mx-auto mb-2" />
                            <p className="font-kurdish">{t.noPatients}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Paramedics Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3 border-b-2 border-secondary pb-2 font-kurdish">
                        <Users className="w-6 h-6 text-secondary-foreground" />
                        <h3 className="text-xl font-bold">{t.paramedics}</h3>
                        <span className="ml-auto bg-secondary/20 text-secondary-foreground px-2 py-0.5 rounded text-xs font-bold">{paramedics.length}</span>
                      </div>
                      <div className="space-y-4">
                        {paramedics.map((paramedic) => (
                          <motion.div 
                            key={paramedic.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-card border p-5 rounded-3xl group shadow-sm hover:shadow-md transition-all border-l-4 border-l-secondary"
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary-foreground shrink-0">
                                  <Stethoscope className="w-6 h-6" />
                                </div>
                                <div>
                                  <h4 className="font-bold text-lg font-kurdish">{paramedic.name}</h4>
                                  <p className="text-muted-foreground font-kurdish mt-1">{paramedic.specialty}</p>
                                  <span className="text-[10px] text-muted-foreground mt-2 block">
                                    {new Date(paramedic.timestamp).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                              <button 
                                onClick={() => deleteParamedic(paramedic.id)}
                                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                        {paramedics.length === 0 && (
                          <div className="text-center py-10 opacity-30">
                            <Users className="w-12 h-12 mx-auto mb-2" />
                            <p className="font-kurdish">{t.noParamedics}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Usual Items Section */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3 border-b-2 border-muted-foreground pb-2 font-kurdish">
                        <CheckCircle2 className="w-6 h-6 text-muted-foreground" />
                        <h3 className="text-xl font-bold">{t.usualList}</h3>
                        <span className="ml-auto bg-muted text-muted-foreground px-2 py-0.5 rounded text-xs font-bold">{usualItems.length}</span>
                      </div>
                      <div className="space-y-4">
                        {usualItems.map((item) => (
                          <motion.div 
                            key={item.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-card border p-5 rounded-3xl group shadow-sm hover:shadow-md transition-all border-l-4 border-l-muted-foreground"
                          >
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="font-bold text-lg font-kurdish">{item.title}</h4>
                                <p className="text-muted-foreground font-kurdish mt-1 whitespace-pre-wrap">{item.description}</p>
                                <span className="text-[10px] text-muted-foreground mt-2 block">
                                  {new Date(item.timestamp).toLocaleString()}
                                </span>
                              </div>
                              <button 
                                onClick={() => deleteUsualItem(item.id)}
                                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                        {usualItems.length === 0 && (
                          <div className="text-center py-10 opacity-30">
                            <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                            <p className="font-kurdish">{t.noItems}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Add Patient Modal */}
                <AnimatePresence>
                  {showAddPatient && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAddPatient(false)}
                        className="absolute inset-0 bg-black/60 backdrop-blur-md"
                      />
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-lg bg-card border rounded-[2.5rem] p-10 shadow-2xl"
                      >
                        <h3 className="text-2xl font-bold font-kurdish mb-6">{t.addPatient}</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.name}</label>
                            <input 
                              type="text" 
                              value={newPatient.name}
                              onChange={(e) => setNewPatient(prev => ({ ...prev, name: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.condition}</label>
                            <textarea 
                              value={newPatient.condition}
                              onChange={(e) => setNewPatient(prev => ({ ...prev, condition: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20 resize-none h-32"
                            />
                          </div>
                          <div className="flex gap-4 pt-4">
                            <button 
                              onClick={handleAddPatient}
                              className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-bold font-kurdish hover:shadow-lg transition-all"
                            >
                              {t.save}
                            </button>
                            <button 
                              onClick={() => setShowAddPatient(false)}
                              className="flex-1 py-4 bg-muted text-muted-foreground rounded-2xl font-bold font-kurdish hover:bg-muted/80 transition-all"
                            >
                              {t.cancel}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Add Paramedic Modal */}
                <AnimatePresence>
                  {showAddParamedic && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAddParamedic(false)}
                        className="absolute inset-0 bg-black/60 backdrop-blur-md"
                      />
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-lg bg-card border rounded-[2.5rem] p-10 shadow-2xl"
                      >
                        <h3 className="text-2xl font-bold font-kurdish mb-6">{t.addParamedic}</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.name}</label>
                            <input 
                              type="text" 
                              value={newParamedic.name}
                              onChange={(e) => setNewParamedic(prev => ({ ...prev, name: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.specialty}</label>
                            <input 
                              type="text" 
                              value={newParamedic.specialty}
                              onChange={(e) => setNewParamedic(prev => ({ ...prev, specialty: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20"
                            />
                          </div>
                          <div className="flex gap-4 pt-4">
                            <button 
                              onClick={handleAddParamedic}
                              className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-bold font-kurdish hover:shadow-lg transition-all"
                            >
                              {t.save}
                            </button>
                            <button 
                              onClick={() => setShowAddParamedic(false)}
                              className="flex-1 py-4 bg-muted text-muted-foreground rounded-2xl font-bold font-kurdish hover:bg-muted/80 transition-all"
                            >
                              {t.cancel}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {/* Add Usual Item Modal */}
                <AnimatePresence>
                  {showAddUsualItem && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowAddUsualItem(false)}
                        className="absolute inset-0 bg-black/60 backdrop-blur-md"
                      />
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-lg bg-card border rounded-[2.5rem] p-10 shadow-2xl"
                      >
                        <h3 className="text-2xl font-bold font-kurdish mb-6">{t.addItem}</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.name}</label>
                            <input 
                              type="text" 
                              value={newUsualItem.title}
                              onChange={(e) => setNewUsualItem(prev => ({ ...prev, title: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-bold font-kurdish mb-2">{t.description}</label>
                            <textarea 
                              value={newUsualItem.description}
                              onChange={(e) => setNewUsualItem(prev => ({ ...prev, description: e.target.value }))}
                              className="w-full bg-muted border-none p-4 rounded-2xl font-kurdish focus:ring-2 ring-primary/20 resize-none h-32"
                            />
                          </div>
                          <div className="flex gap-4 pt-4">
                            <button 
                              onClick={handleAddUsualItem}
                              className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl font-bold font-kurdish hover:shadow-lg transition-all"
                            >
                              {t.save}
                            </button>
                            <button 
                              onClick={() => setShowAddUsualItem(false)}
                              className="flex-1 py-4 bg-muted text-muted-foreground rounded-2xl font-bold font-kurdish hover:bg-muted/80 transition-all"
                            >
                              {t.cancel}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="flex-1 p-6 md:p-10 overflow-y-auto w-full max-w-4xl mx-auto"
              >
                <div className="flex items-center gap-4 mb-10">
                   <div className="p-3 bg-primary/10 rounded-2xl">
                     <Settings className="w-8 h-8 text-primary" />
                   </div>
                   <h2 className="text-3xl font-bold font-kurdish">{t.appSettings}</h2>
                </div>

                <div className="space-y-8">
                  <section className="bg-card border rounded-3xl p-8 shadow-sm">
                    <h3 className="text-xl font-bold mb-6 font-kurdish flex items-center gap-2 border-b pb-4">
                      <LayoutDashboard className="w-5 h-5 text-primary" />
                      {t.generalSettings}
                    </h3>
                    
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="font-bold font-kurdish text-lg">{t.darkMode}</span>
                          <p className="text-sm text-muted-foreground font-kurdish">{t.darkModeDesc}</p>
                        </div>
                        <button 
                          onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                          className={cn(
                            "w-14 h-7 rounded-full p-1 transition-colors duration-300 relative",
                            theme === 'dark' ? "bg-primary" : "bg-slate-300"
                          )}
                        >
                          <motion.div 
                            animate={{ x: theme === 'dark' ? -28 : 0 }}
                            className="w-5 h-5 bg-white rounded-full shadow-md" 
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between border-t pt-6">
                        <div className="space-y-1">
                          <span className="font-bold font-kurdish text-lg">{t.highContrast}</span>
                          <p className="text-sm text-muted-foreground font-kurdish">{t.highContrastDesc}</p>
                        </div>
                        <button 
                          onClick={() => setHighContrast(prev => !prev)}
                          className={cn(
                            "w-14 h-7 rounded-full p-1 transition-colors duration-300 relative",
                            highContrast ? "bg-primary" : "bg-slate-300"
                          )}
                        >
                          <motion.div 
                            animate={{ x: highContrast ? (language === 'ku' || language === 'ar' || language === 'fa' ? -28 : 28) : 0 }}
                            className="w-5 h-5 bg-white rounded-full shadow-md" 
                          />
                        </button>
                      </div>

                      <div className="border-t pt-6">
                        <div className="flex items-center gap-2 mb-4">
                          <HelpCircle className="w-5 h-5 text-primary" />
                          <span className="font-bold font-kurdish text-lg">{t.language}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {[
                            'ku', 'en', 'ar', 'fa', 'tr', 'fr', 'de', 'es'
                          ].map((code) => (
                            <button
                              key={code}
                              onClick={() => setLanguage(code as LanguageCode)}
                              className={cn(
                                "p-4 rounded-2xl border text-center transition-all font-medium",
                                language === code ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted border-border"
                              )}
                            >
                              {translations[code as LanguageCode].nativeName}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="p-6 bg-card border rounded-3xl shadow-sm hover:border-primary transition-colors flex items-center gap-4">
                       <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                         <ChevronRight className="w-6 h-6 rotate-180" />
                       </div>
                       <div>
                         <h4 className="font-bold font-kurdish">{t.about}</h4>
                         <p className="text-xs text-muted-foreground font-kurdish">{t.aboutDesc}</p>
                       </div>
                    </div>
                    <div className="p-6 bg-card border rounded-3xl shadow-sm hover:border-primary transition-colors flex items-center gap-4">
                       <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                         <Trash2 className="w-6 h-6" />
                       </div>
                       <div>
                         <h4 className="font-bold font-kurdish">{t.clearData}</h4>
                         <p className="text-xs text-muted-foreground font-kurdish">{t.clearDataDesc}</p>
                       </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
      
    </div>
  );
}
