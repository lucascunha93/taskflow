import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { App } from './app.component';
import { appConfig } from './app.config';
import { API_BASE_URL } from './core/api-base-url';
import { environment } from '../environments/environment';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the public login route and router outlet without a session', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Entre na sua conta');
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('provides the router, HttpClient and configured API base URL', () => {
    expect(TestBed.inject(Router)).toBeTruthy();
    expect(TestBed.inject(HttpClient)).toBeTruthy();
    expect(TestBed.inject(API_BASE_URL)).toBe(environment.apiBaseUrl);
  });

  it('configures HttpClient to send requests through the HTTP pipeline', async () => {
    const http = TestBed.inject(HttpClient);
    const controller = TestBed.inject(HttpTestingController);
    const response = firstValueFrom(http.get('/foundation-test'));
    controller.expectOne('/foundation-test').flush({ ok: true });
    await expect(response).resolves.toEqual({ ok: true });
    controller.verify();
  });
});
