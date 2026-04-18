import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  isDark = signal(false);

  constructor() {
    const saved = localStorage.getItem('nanoclaw-theme');
    if (saved === 'dark') this.setDark();
    else this.setLight();
  }

  toggle(): void {
    if (this.isDark()) this.setLight();
    else this.setDark();
  }

  private setLight(): void {
    this.isDark.set(false);
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('nanoclaw-theme', 'light');
  }

  private setDark(): void {
    this.isDark.set(true);
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('nanoclaw-theme', 'dark');
  }
}
