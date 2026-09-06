const groups: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C / C++",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  rb: "Ruby",
  php: "PHP",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  html: "HTML",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  lua: "Lua",
  md: "Markdown",
  mdx: "MDX",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  tf: "HCL",
  tfvars: "HCL",
  xml: "XML",
  txt: "Text",
  rst: "reStructuredText",
  lock: "Lockfiles",
};
export function languageOf(path: string) {
  const file = path.split("/").at(-1)!.toLowerCase();
  if (file === "dockerfile" || file.startsWith("dockerfile."))
    return "Dockerfile";
  if (file === "makefile") return "Makefile";
  if (/^(pnpm-lock.yaml|package-lock.json|yarn.lock)$/.test(file))
    return "Lockfiles";
  const extension = file.split(".").at(-1)!;
  return Object.hasOwn(groups, extension)
    ? groups[extension]!
    : "Other / unknown";
}
