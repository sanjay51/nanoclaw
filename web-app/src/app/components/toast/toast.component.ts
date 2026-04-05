import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    @if (svc.toast(); as t) {
      <div class="fixed bottom-5 right-5 px-4 py-2.5 rounded-xl text-white text-sm font-medium z-50 transition-all duration-200 pointer-events-none"
           [class.opacity-100]="t.visible" [class.opacity-0]="!t.visible"
           [class.translate-y-0]="t.visible" [class.translate-y-2]="!t.visible"
           [class.bg-green-500]="!t.isError" [class.bg-red-500]="t.isError">
        {{ t.message }}
      </div>
    }
  `,
})
export class ToastComponent {
  svc = inject(ToastService);
}
