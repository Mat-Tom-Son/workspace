export const primaryNavigation = [
  { id: "files", label: "Files" },
  { id: "capabilities", label: "Capabilities" },
  { id: "chats", label: "Chats" },
  { id: "library", label: "Library" },
  { id: "history", label: "History" },
] as const;

export const welcomeActions = {
  create: "Create a Space",
  linkFolder: "Turn an existing folder into a Space",
} as const;
