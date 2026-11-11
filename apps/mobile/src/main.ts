import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app.component';
import { initErrorReporting, provideErrorReporting } from './app/core/error-reporting';
import { environment } from './environments/environment';

// A captura de erros é iniciada antes do Angular, para incluir falhas do bootstrap.
const reporting = initErrorReporting(environment);

bootstrapApplication(App, { ...appConfig, providers: [...appConfig.providers, ...provideErrorReporting(reporting)] })
  .catch((err) => console.error(err));
