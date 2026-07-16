export function readableTextColorOn(color: string): string {
  const backgroundLuminance = relativeLuminance(color);
  const darkText = "#182846";
  const darkContrast = contrastRatio(backgroundLuminance, relativeLuminance(darkText));
  const lightContrast = contrastRatio(backgroundLuminance, 1);
  return darkContrast >= lightContrast ? darkText : "#ffffff";
}

function relativeLuminance(color: string): number {
  const normalized = color.replace("#", "");
  const channel = (offset: number) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
