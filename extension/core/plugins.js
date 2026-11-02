// Packaged prompt plugins are synchronous and receive settings, never credentials or DOM access.
export const promptPlugins = Object.freeze([
  {
    id: "glossary",
    enabled: config => config.glossaryEnabled && Boolean(config.glossary.trim()),
    instructions: config => `Use these terminology preferences where applicable:\n${config.glossary}`,
  },
  {
    id: "custom-prompt",
    enabled: config => Boolean(config.prompt.trim()),
    instructions: config => `Additional translation preferences:\n${config.prompt}`,
  },
]);
