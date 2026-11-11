// Carregado antes de qualquer outro módulo (primeiro import de main.ts), como
// exige o SDK do Sentry para instrumentar HTTP e Express.
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { sentryOptions } from './monitoring/sentry-options.js';

const options = sentryOptions(process.env);
if (options) Sentry.init(options);
