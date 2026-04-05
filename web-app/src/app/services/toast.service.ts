import { Injectable, signal } from '@angular/core';

export interface Toast {
  message: string;
  isError: boolean;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toast = signal<Toast>({ message: '', isError: false, visible: false });
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, isError = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.toast.set({ message, isError, visible: true });
    this.timer = setTimeout(() => {
      this.toast.set({ message: '', isError: false, visible: false });
    }, 2500);
  }
}
