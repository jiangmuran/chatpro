export type ThemeId = "chatgpt" | "soft" | "miku";
export type ModelTier = "normal" | "enhanced" | "pro";
export type PersonaType = "scenario" | "professional";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  favorite?: boolean;
  replyTo?: {
    id: string;
    role: "user" | "assistant";
    excerpt: string;
  };
};

export type Conversation = {
  id: string;
  title: string;
  personaId: string | null;
  model: ModelTier;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt?: string;
};

export type Persona = {
  id: string;
  name: string;
  type: PersonaType;
  prompt: string;
};
