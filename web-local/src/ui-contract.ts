export const primaryNavigation = [
  { id: "space", label: "Space" },
  { id: "chats", label: "Chats" },
  { id: "library", label: "Library" },
  { id: "history", label: "History" },
] as const;

export const assistantNavigation = [
  { id: "setup", label: "Setup" },
  { id: "skills", label: "Skills" },
  { id: "extensions", label: "Extensions" },
] as const;

export const welcomeActions = {
  create: "Create a Space",
  linkFolder: "Turn an existing folder into a Space",
} as const;
