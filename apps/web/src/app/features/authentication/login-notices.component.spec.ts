import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api-base-url';
import { LoginComponent } from './login.component';

describe('LoginComponent notices', () => {
  async function render(query: Record<string, string>): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('confirms that all sessions were ended', async () => {
    const element = await render({ sessions: 'ended' });
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Todas as sessões foram encerradas');
  });

  it('shows no notice without a recognized query parameter', async () => {
    const element = await render({ sessions: 'other' });
    expect(element.querySelector('[role="status"]')).toBeNull();
  });
});
