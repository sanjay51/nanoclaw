import { Component, inject, OnInit, OnDestroy, signal, ElementRef, ViewChild, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Personality } from '../../shared/types';
import EditorJS from '@editorjs/editorjs';
import Header from '@editorjs/header';
import List from '@editorjs/list';
import Code from '@editorjs/code';
import Quote from '@editorjs/quote';
import Delimiter from '@editorjs/delimiter';
import Marker from '@editorjs/marker';
import InlineCode from '@editorjs/inline-code';

@Component({
  selector: 'app-personalities',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="px-6 py-4 border-b border-border bg-surface flex items-center justify-between">
      <div class="flex items-center gap-3">
        @if (editing()) {
          <button (click)="cancelEdit()" class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" title="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          </button>
        }
        <h2 class="text-lg font-semibold">{{ editing() ? (editId ? 'Edit Personality' : 'New Personality') : 'Personalities' }}</h2>
      </div>
      <div class="flex gap-2">
        @if (editing()) {
          <button (click)="cancelEdit()" class="px-4 py-1.5 rounded border border-border text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button>
          <button (click)="saveEdit()" class="px-4 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">Save</button>
        } @else {
          <button (click)="startCreate()" class="px-3 py-1.5 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover">+ New Personality</button>
        }
      </div>
    </div>

    @if (editing()) {
      <div class="flex-1 overflow-y-auto">
        <div class="p-6 max-w-5xl mx-auto">
          <div class="mb-5">
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">Name</label>
            <input [(ngModel)]="editName" placeholder="e.g. Friendly Helper" class="w-full max-w-md px-3 py-2 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent">
          </div>
          <div>
            <label class="block text-xs font-medium text-zinc-500 mb-1.5">Instructions</label>
            <div class="editorjs-wrapper border border-border rounded-lg bg-zinc-950 min-h-[400px]">
              <div #editorContainer id="editorjs"></div>
            </div>
            <p class="text-xs text-zinc-600 mt-2">Use headings, lists, quotes, and code blocks to structure your personality instructions.</p>
          </div>
        </div>
      </div>
    } @else {
      <div class="p-6 overflow-y-auto flex-1">
        @if (personalities().length === 0) {
          <div class="text-zinc-500 text-sm">No personalities yet. Create one to get started.</div>
        } @else {
          <div class="grid gap-3 max-w-5xl" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
            @for (p of personalities(); track p.id) {
              <div (click)="startEdit(p)" class="border border-border rounded-lg p-4 bg-surface hover:border-zinc-600 transition-colors cursor-pointer group">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <h4 class="font-medium text-sm">{{ p.name }}</h4>
                    <p class="text-xs text-zinc-500 mt-1 line-clamp-3 whitespace-pre-wrap">{{ p.instructions || 'No instructions set' }}</p>
                  </div>
                  <button (click)="remove($event, p)" class="px-2 py-1 rounded border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Delete</button>
                </div>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host ::ng-deep .editorjs-wrapper {
      padding: 16px 24px;
    }
    :host ::ng-deep .editorjs-wrapper .ce-block__content {
      max-width: 100%;
    }
    :host ::ng-deep .editorjs-wrapper .ce-toolbar__content {
      max-width: 100%;
    }
    :host ::ng-deep .editorjs-wrapper .codex-editor__redactor {
      padding-bottom: 150px !important;
    }
    :host ::ng-deep .editorjs-wrapper .ce-paragraph,
    :host ::ng-deep .editorjs-wrapper .ce-header,
    :host ::ng-deep .editorjs-wrapper .ce-code,
    :host ::ng-deep .editorjs-wrapper .ce-quote,
    :host ::ng-deep .editorjs-wrapper .cdx-list {
      color: #f4f4f5;
    }
    :host ::ng-deep .editorjs-wrapper .ce-paragraph {
      font-size: 14px;
      line-height: 1.6;
    }
    :host ::ng-deep .editorjs-wrapper .ce-header {
      font-weight: 600;
    }
    :host ::ng-deep .editorjs-wrapper .ce-code__textarea {
      background: #0a0a0a;
      border: 1px solid #2a2a2a;
      color: #f4f4f5;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      border-radius: 6px;
      min-height: 60px;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-quote__text {
      border-left: 3px solid #3b82f6;
      padding-left: 12px;
      color: #d4d4d8;
      font-style: italic;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-quote__caption {
      color: #71717a;
      font-size: 12px;
    }
    :host ::ng-deep .editorjs-wrapper .ce-toolbar__plus,
    :host ::ng-deep .editorjs-wrapper .ce-toolbar__settings-btn {
      color: #71717a;
      background: transparent;
    }
    :host ::ng-deep .editorjs-wrapper .ce-toolbar__plus:hover,
    :host ::ng-deep .editorjs-wrapper .ce-toolbar__settings-btn:hover {
      color: #f4f4f5;
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-popover {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-popover-item:hover {
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-popover-item__title {
      color: #f4f4f5;
    }
    :host ::ng-deep .editorjs-wrapper .ce-popover-item__icon {
      color: #d4d4d8;
      background: #27272a;
      border: 1px solid #333;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-marker {
      background: rgba(59, 130, 246, 0.3);
      color: inherit;
      padding: 2px 0;
    }
    :host ::ng-deep .editorjs-wrapper .inline-code {
      background: #27272a;
      color: #f472b6;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.9em;
    }
    :host ::ng-deep .editorjs-wrapper .ce-inline-toolbar {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-inline-toolbar__dropdown {
      border-right: 1px solid #2a2a2a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-inline-tool {
      color: #d4d4d8;
    }
    :host ::ng-deep .editorjs-wrapper .ce-inline-tool:hover {
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-inline-tool--active {
      color: #3b82f6;
    }
    :host ::ng-deep .editorjs-wrapper .ce-conversion-toolbar {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-conversion-tool:hover {
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .ce-conversion-tool__icon {
      color: #d4d4d8;
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-settings-button {
      color: #d4d4d8;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-settings-button:hover {
      background: #27272a;
    }
    :host ::ng-deep .editorjs-wrapper .cdx-list__item {
      padding: 2px 0;
    }
    :host ::ng-deep .editorjs-wrapper .ce-delimiter {
      line-height: 0 !important;
      height: 1px !important;
      background: #333;
      margin: 16px 0;
      overflow: hidden;
    }
    :host ::ng-deep .editorjs-wrapper .ce-delimiter::before {
      display: none !important;
    }
  `],
})
export class PersonalitiesComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('editorContainer') editorContainer!: ElementRef;

  personalities = signal<Personality[]>([]);
  editing = signal(false);
  editId = '';
  editName = '';
  editInstructions = '';

  private editor: EditorJS | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    this.destroyEditor();
  }

  async load(): Promise<void> {
    try {
      this.personalities.set(await this.api.getPersonalities());
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  startCreate(): void {
    this.editId = '';
    this.editName = '';
    this.editInstructions = '';
    this.editing.set(true);
    this.cdr.detectChanges();
    this.initEditor('');
  }

  startEdit(p: Personality): void {
    this.editId = p.id;
    this.editName = p.name;
    this.editInstructions = p.instructions;
    this.editing.set(true);
    this.cdr.detectChanges();
    this.initEditor(p.instructions);
  }

  cancelEdit(): void {
    this.destroyEditor();
    this.editing.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editName.trim()) {
      this.toast.show('Name is required', true);
      return;
    }
    const markdown = await this.getMarkdown();
    try {
      if (this.editId) {
        await this.api.updatePersonality(this.editId, {
          name: this.editName.trim(),
          instructions: markdown,
        });
        this.toast.show('Personality updated');
      } else {
        await this.api.createPersonality({
          name: this.editName.trim(),
          instructions: markdown,
        });
        this.toast.show('Personality created');
      }
      this.destroyEditor();
      this.editing.set(false);
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  async remove(event: Event, p: Personality): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Delete personality "${p.name}"?`)) return;
    try {
      await this.api.deletePersonality(p.id);
      this.toast.show('Personality deleted');
      await this.load();
    } catch (e: any) {
      this.toast.show(e.message, true);
    }
  }

  private initEditor(markdown: string): void {
    this.destroyEditor();
    const data = this.markdownToEditorData(markdown);
    this.editor = new EditorJS({
      holder: 'editorjs',
      placeholder: 'Start writing personality instructions...',
      data,
      tools: {
        header: {
          class: Header as any,
          config: { levels: [1, 2, 3, 4], defaultLevel: 2 },
        },
        list: { class: List as any, inlineToolbar: true },
        code: { class: Code as any },
        quote: { class: Quote as any, inlineToolbar: true },
        delimiter: { class: Delimiter as any },
        marker: { class: Marker as any },
        inlineCode: { class: InlineCode as any },
      },
    });
  }

  private destroyEditor(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  private async getMarkdown(): Promise<string> {
    if (!this.editor) return this.editInstructions;
    const data = await this.editor.save();
    return this.editorDataToMarkdown(data);
  }

  // Convert Editor.js output data to markdown string
  private editorDataToMarkdown(data: any): string {
    const lines: string[] = [];
    for (const block of data.blocks) {
      switch (block.type) {
        case 'header':
          lines.push('#'.repeat(block.data.level) + ' ' + this.inlineToMarkdown(block.data.text));
          lines.push('');
          break;
        case 'paragraph':
          lines.push(this.inlineToMarkdown(block.data.text));
          lines.push('');
          break;
        case 'list': {
          const items: string[] = block.data.items.map
            ? block.data.items
            : [];
          this.renderListItems(items, block.data.style, 0, lines);
          lines.push('');
          break;
        }
        case 'code':
          lines.push('```');
          lines.push(block.data.code);
          lines.push('```');
          lines.push('');
          break;
        case 'quote':
          const quoteLines = this.inlineToMarkdown(block.data.text).split('\n');
          for (const ql of quoteLines) {
            lines.push('> ' + ql);
          }
          if (block.data.caption) {
            lines.push('> ');
            lines.push('> — ' + this.inlineToMarkdown(block.data.caption));
          }
          lines.push('');
          break;
        case 'delimiter':
          lines.push('---');
          lines.push('');
          break;
        default:
          if (block.data.text) {
            lines.push(this.inlineToMarkdown(block.data.text));
            lines.push('');
          }
      }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private renderListItems(items: any[], style: string, depth: number, lines: string[]): void {
    const indent = '  '.repeat(depth);
    const prefix = style === 'ordered' ? '1. ' : '- ';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Editor.js list items can be strings or objects with content/items
      if (typeof item === 'string') {
        lines.push(indent + prefix + this.inlineToMarkdown(item));
      } else if (item.content !== undefined) {
        lines.push(indent + prefix + this.inlineToMarkdown(item.content));
        if (item.items && item.items.length > 0) {
          this.renderListItems(item.items, style, depth + 1, lines);
        }
      }
    }
  }

  // Convert inline HTML (bold, italic, code, marker) to markdown
  private inlineToMarkdown(html: string): string {
    if (!html) return '';
    let md = html;
    md = md.replace(/<b>(.*?)<\/b>/gi, '**$1**');
    md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<i>(.*?)<\/i>/gi, '*$1*');
    md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
    md = md.replace(/<code class="inline-code">(.*?)<\/code>/gi, '`$1`');
    md = md.replace(/<code>(.*?)<\/code>/gi, '`$1`');
    md = md.replace(/<mark class="cdx-marker">(.*?)<\/mark>/gi, '==$1==');
    md = md.replace(/<mark>(.*?)<\/mark>/gi, '==$1==');
    md = md.replace(/<a href="(.*?)">(.*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<\/?[^>]+(>|$)/g, ''); // strip remaining HTML tags
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    return md;
  }

  // Convert markdown string to Editor.js data format
  private markdownToEditorData(markdown: string): any {
    if (!markdown || !markdown.trim()) {
      return { time: Date.now(), blocks: [] };
    }

    const blocks: any[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Delimiter
      if (/^---+\s*$/.test(line.trim()) || /^\*\*\*+\s*$/.test(line.trim())) {
        blocks.push({ type: 'delimiter', data: {} });
        i++;
        continue;
      }

      // Header
      const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headerMatch) {
        blocks.push({
          type: 'header',
          data: { text: this.markdownInlineToHtml(headerMatch[2]), level: headerMatch[1].length },
        });
        i++;
        continue;
      }

      // Code block
      if (line.trim().startsWith('```')) {
        i++;
        const codeLines: string[] = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
        i++; // skip closing ```
        continue;
      }

      // Quote
      if (line.startsWith('> ') || line === '>') {
        const quoteLines: string[] = [];
        while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        const text = quoteLines.join('\n');
        const captionMatch = text.match(/\n?\s*—\s*(.+)$/);
        blocks.push({
          type: 'quote',
          data: {
            text: this.markdownInlineToHtml(captionMatch ? text.replace(captionMatch[0], '') : text),
            caption: captionMatch ? this.markdownInlineToHtml(captionMatch[1]) : '',
          },
        });
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(this.markdownInlineToHtml(lines[i].replace(/^\s*[-*+]\s+/, '')));
          i++;
        }
        blocks.push({ type: 'list', data: { style: 'unordered', items } });
        continue;
      }

      // Ordered list
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(this.markdownInlineToHtml(lines[i].replace(/^\s*\d+[.)]\s+/, '')));
          i++;
        }
        blocks.push({ type: 'list', data: { style: 'ordered', items } });
        continue;
      }

      // Paragraph (default)
      blocks.push({
        type: 'paragraph',
        data: { text: this.markdownInlineToHtml(line) },
      });
      i++;
    }

    return { time: Date.now(), blocks };
  }

  // Convert markdown inline formatting to HTML for Editor.js
  private markdownInlineToHtml(text: string): string {
    if (!text) return '';
    let html = text;
    // Escape HTML entities that aren't part of formatting
    html = html.replace(/&/g, '&amp;');
    html = html.replace(/</g, '&lt;');
    html = html.replace(/>/g, '&gt;');
    // Inline code (before bold/italic to avoid conflicts)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    html = html.replace(/_(.+?)_/g, '<i>$1</i>');
    // Highlight
    html = html.replace(/==(.+?)==/g, '<mark class="cdx-marker">$1</mark>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return html;
  }
}
