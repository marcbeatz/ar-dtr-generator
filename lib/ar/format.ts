export type Bullet = {
  text: string;
  children: string[];
};

export type Section = {
  heading: string;
  bullets: Bullet[];
};

export type Notes = {
  intro: string;
  sections: Section[];
};

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && text === text.toUpperCase() && text.length <= 36 && !/[.]/.test(text);
}

function isToken(text: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,24}$/.test(text);
}

export function isHeading(text: string): boolean {
  return isToken(text) || isAllCaps(text);
}

function bulletOf(line: string): { level: "parent" | "child"; text: string } | null {
  const indented = /^(\s{2,}|\t)/.test(line);
  const trimmed = line.trim();
  const childMark = trimmed.match(/^(?:○|o|◦)\s+(.+)$/);
  const parentMark = trimmed.match(/^(?:●|•|\*|-)\s+(.+)$/);
  if (indented && childMark) return { level: "child", text: clean(childMark[1]) };
  if (indented && parentMark) return { level: "child", text: clean(parentMark[1]) };
  if (indented) return { level: "child", text: clean(trimmed) };
  if (childMark) return { level: "child", text: clean(childMark[1]) };
  if (parentMark) return { level: "parent", text: clean(parentMark[1]) };
  return null;
}

export function formatNotes(raw: string): Notes {
  const lines = raw.replace(/\t/g, "  ").split(/\r?\n/);
  let intro = "";
  let introOpen = true;
  const sections: Section[] = [];
  let current: Section | null = null;

  const ensure = () => {
    if (!current) {
      current = { heading: "", bullets: [] };
      sections.push(current);
    }
    return current;
  };

  for (const line of lines) {
    if (!line.trim()) {
      if (introOpen && intro) introOpen = false;
      continue;
    }
    const marked = bulletOf(line);
    const plain = clean(line);
    if (!marked && isHeading(plain)) {
      introOpen = false;
      current = { heading: plain, bullets: [] };
      sections.push(current);
      continue;
    }
    if (introOpen && !marked) {
      intro = clean(intro ? `${intro} ${plain}` : plain);
      continue;
    }
    introOpen = false;
    const section = ensure();
    if (marked?.level === "child" && section.bullets.length) {
      section.bullets[section.bullets.length - 1].children.push(marked.text);
      continue;
    }
    section.bullets.push({ text: marked?.text ?? plain, children: [] });
  }

  return {
    intro: clean(intro),
    sections: sections.filter((section) => section.heading || section.bullets.length),
  };
}

export function toNotes(intro: string, sections: Section[]): string {
  const parts: string[] = [];
  if (intro.trim()) parts.push(clean(intro));
  for (const section of sections) {
    const lines: string[] = [];
    if (section.heading.trim()) lines.push(section.heading.trim());
    for (const bullet of section.bullets) {
      if (!bullet.text.trim()) continue;
      lines.push(clean(bullet.text));
      for (const child of bullet.children) {
        if (child.trim()) lines.push(`  ${clean(child)}`);
      }
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
