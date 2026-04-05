import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  isDark = signal(true);

  constructor() {
    const saved = localStorage.getItem('nanoclaw-theme');
    if (saved === 'light') this.setLight();
  }

  toggle(): void {
    if (this.isDark()) this.setLight();
    else this.setDark();
  }

  private setLight(): void {
    this.isDark.set(false);
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('nanoclaw-theme', 'light');
  }

  private setDark(): void {
    this.isDark.set(true);
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('nanoclaw-theme', 'dark');
  }
}
