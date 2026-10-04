// The smokes run without a key, on the sample replies that stand in for a model. The app gives those only when this
// variable is set (apps/desktop/src/shared/demo-replies.ts), and never in an app a person runs. Every smoke imports
// `smoke-language.mjs` or `packaged-executable.mjs` before it builds the environment it launches the app with, and both
// import this file, so the app a smoke starts always has it.
process.env.ORGLET_DEMO_REPLIES ??= '1';
