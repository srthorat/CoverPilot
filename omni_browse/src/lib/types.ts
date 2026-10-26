export interface DOMElement {
  id: string;
  tag: 'button' | 'input' | 'select' | 'div' | 'span' | 'a';
  label: string;
  type?: string;
  placeholder?: string;
  value?: string;
  options?: string[];
  disabled?: boolean;
  checked?: boolean;
  // Meta SAM 3 Segmentation Mask
  samMask: {
    x: number;      // percentage
    y: number;      // percentage
    width: number;  // percentage
    height: number; // percentage
    confidence: number;
    category: 'interactive_button' | 'form_input' | 'navigation_link' | 'selection_dropdown' | 'action_card';
  };
}

export interface Scenario {
  id: string;
  title: string;
  category: string;
  targetUrl: string;
  description: string;
  badge: string;
  elements: DOMElement[];
  samplePrompts: string[];
  initialState: Record<string, any>;
}

export type AgentStepType = 
  | 'glimmer_perceive' // Meta Glimmer real-time UI element perception & hesitation detection
  | 'sam_segment'      // Meta SAM 3 zero-shot visual UI surface segmentation & spotlight mask
  | 'spark_reason'     // Meta Muse Spark deep chain-of-thought policy & risk evaluation
  | 'voice_guide'      // Meta Muse Voice speech synthesis (English, Hindi, Marathi)
  | 'user_confirm'     // Human-in-the-loop safety barrier (Non-acting, user retains control)
  | 'complete';        // Task resolved

export interface AgentStep {
  id: string;
  timestamp: number;
  type: AgentStepType;
  title: string;
  content: string;
  metadata?: {
    modelUsed?: 'muse-spark-1.3' | 'sam-3' | 'glimmer' | 'muse-voice';
    targetElementId?: string;
    toolName?: string;
    toolArgs?: Record<string, any>;
    reasoningEffort?: 'low' | 'medium' | 'high';
    confidence?: number;
    requiresConfirmation?: boolean;
  };
}
