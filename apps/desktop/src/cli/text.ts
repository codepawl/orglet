import { translate, translateMessage } from '../shared/i18n';
import { en } from '../shared/locales/en';

/** A whole message written elsewhere in Vietnamese (shared code, the app's answers), in the terminal's language. */
export function tMessage(message: string): string {
  return translateMessage(en, message);
}

/** The terminal currently speaks English; new copy shares the desktop's Vietnamese source keys. */
export function t(source: string, ...parameters: unknown[]): string {
  return translate(en, source, parameters);
}
