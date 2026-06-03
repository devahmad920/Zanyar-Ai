import { KurdishTranslations } from './translations';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  category: string;
}

export interface UsualItem {
  id: string;
  title: string;
  description: string;
  timestamp: number;
}

export interface AppState {
  theme: 'light' | 'dark';
  language: 'ku' | 'en';
  messages: Message[];
  isThinking: boolean;
  highContrast: boolean;
}
