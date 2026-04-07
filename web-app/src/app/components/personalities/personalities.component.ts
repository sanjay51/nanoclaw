import { Component, inject, OnInit, OnDestroy, signal, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
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

interface Section {
  id: string;
  name: string;
  content: string;
  children: Section[];
}

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
        @if (editing()) {
          <span class="text-zinc-500 text-sm">—</span>
          <input [(ngModel)]="editName" placeholder="Personality name" class="px-2 py-1 rounded border border-border bg-zinc-950 text-sm outline-none focus:border-accent w-48">
        }
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
      <div class="flex flex-1 min-h-0">
        <!-- Section sidebar -->
        <div class="w-52 border-r border-border bg-surface flex flex-col shrink-0">
          <div class="flex-1 overflow-y-auto py-2">
            @for (section of sections; track section.id) {
              <div class="section-item" [class.active]="activeSection?.id === section.id">
                <div class="flex items-center group" (click)="selectSection(section)">
                  @if (section.children.length > 0) {
                    <button (click)="toggleCollapse($event, section)" class="p-0.5 text-zinc-500 hover:text-zinc-300 shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" [style.transform]="isCollapsed(section) ? '' : 'rotate(90deg)'" style="transition: transform 0.15s"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  } @else {
                    <span class="w-4 shrink-0"></span>
                  }
                  @if (renamingId === section.id) {
                    <input #renameInput [(ngModel)]="renameValue" (blur)="finishRename(section)" (keydown.enter)="finishRename(section)" (keydown.escape)="cancelRename()" class="flex-1 px-1.5 py-1 text-xs bg-zinc-950 border border-accent rounded outline-none min-w-0" (click)="$event.stopPropagation()">
                  } @else {
                    <span class="flex-1 px-1.5 py-1 text-xs truncate cursor-pointer">{{ section.name }}</span>
                  }
                  <div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pr-1">
                    <button (click)="addSubsection($event, section)" class="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800" title="Add subsection">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                    </button>
                    <button (click)="startRename($event, section)" class="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800" title="Rename">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
                    </button>
                    @if (sections.length > 1) {
                      <button (click)="removeSection($event, section)" class="p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    }
                  </div>
                </div>
                <!-- Subsections -->
                @if (!isCollapsed(section) && section.children.length > 0) {
                  @for (child of section.children; track child.id) {
                    <div class="section-item sub" [class.active]="activeSection?.id === child.id">
                      <div class="flex items-center group pl-4" (click)="selectSection(child)">
                        <span class="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0 mr-1.5"></span>
                        @if (renamingId === child.id) {
                          <input #renameInput [(ngModel)]="renameValue" (blur)="finishRename(child)" (keydown.enter)="finishRename(child)" (keydown.escape)="cancelRename()" class="flex-1 px-1.5 py-1 text-xs bg-zinc-950 border border-accent rounded outline-none min-w-0" (click)="$event.stopPropagation()">
                        } @else {
                          <span class="flex-1 px-1 py-1 text-xs truncate cursor-pointer text-zinc-400">{{ child.name }}</span>
                        }
                        <div class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pr-1">
                          <button (click)="startRename($event, child)" class="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800" title="Rename">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
                          </button>
                          <button (click)="removeSection($event, child, section)" class="p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800" title="Delete">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                }
              </div>
            }
          </div>
          <div class="p-2 border-t border-border">
            <button (click)="addSection()" class="w-full px-2 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 flex items-center gap-1.5 justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              Add section
            </button>
          </div>
        </div>

        <!-- Editor area -->
        <div class="flex-1 flex flex-col min-w-0">
          @if (activeSection) {
            <div class="px-5 py-3 border-b border-border bg-surface flex items-center gap-2">
              <span class="text-xs text-zinc-500">{{ getActiveSectionPath() }}</span>
            </div>
            <div class="flex-1 overflow-y-auto">
              <div class="editorjs-wrapper">
                <div #editorContainer id="editorjs"></div>
              </div>
            </div>
          } @else {
            <div class="flex-1 flex items-center justify-center text-zinc-500 text-sm">
              Select a section to edit
            </div>
          }
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
                    <p class="text-xs text-zinc-500 mt-1 line-clamp-3 whitespace-pre-wrap">{{ getSectionSummary(p.instructions) }}</p>
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
    .section-item > div {
      padding: 2px 4px;
      margin: 0 4px;
      border-radius: 4px;
      cursor: pointer;
    }
    .section-item > div:hover {
      background: rgba(255,255,255,0.05);
    }
    .section-item.active > div {
      background: rgba(59, 130, 246, 0.15);
    }
    .section-item.active > div span:not(.w-1\.5) {
      color: #93c5fd;
    }
    :host ::ng-deep .editorjs-wrapper {
      padding: 16px 24px;
      min-height: 100%;
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

  sections: Section[] = [];
  activeSection: Section | null = null;
  collapsedIds = new Set<string>();
  renamingId: string | null = null;
  renameValue = '';

  private editor: EditorJS | null = null;
  private idCounter = 0;

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
    this.sections = [
      this.makeSection('Identity'),
      this.makeSection('Skills'),
      this.makeSection('Behavior'),
    ];
    this.editing.set(true);
    this.cdr.detectChanges();
    this.selectSection(this.sections[0]);
  }

  startEdit(p: Personality): void {
    this.editId = p.id;
    this.editName = p.name;
    this.sections = this.markdownToSections(p.instructions);
    if (this.sections.length === 0) {
      this.sections = [this.makeSection('Identity')];
    }
    this.editing.set(true);
    this.cdr.detectChanges();
    this.selectSection(this.sections[0]);
  }

  cancelEdit(): void {
    this.destroyEditor();
    this.activeSection = null;
    this.sections = [];
    this.editing.set(false);
  }

  async saveEdit(): Promise<void> {
    if (!this.editName.trim()) {
      this.toast.show('Name is required', true);
      return;
    }
    await this.saveCurrentSectionContent();
    const markdown = this.sectionsToMarkdown(this.sections);
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
      this.activeSection = null;
      this.sections = [];
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

  async selectSection(section: Section): Promise<void> {
    if (this.activeSection?.id === section.id) return;
    await this.saveCurrentSectionContent();
    this.activeSection = section;
    this.cdr.detectChanges();
    this.initEditor(section.content);
  }

  addSection(): void {
    const section = this.makeSection('New Section');
    this.sections.push(section);
    this.selectSection(section);
  }

  addSubsection(event: Event, parent: Section): void {
    event.stopPropagation();
    const child = this.makeSection('New Subsection');
    parent.children.push(child);
    this.collapsedIds.delete(parent.id);
    this.selectSection(child);
  }

  async removeSection(event: Event, section: Section, parent?: Section): Promise<void> {
    event.stopPropagation();
    const list = parent ? parent.children : this.sections;
    const idx = list.indexOf(section);
    if (idx === -1) return;
    list.splice(idx, 1);
    if (this.activeSection?.id === section.id) {
      this.destroyEditor();
      this.activeSection = null;
      // Select next available
      const next = parent?.children[0] || this.sections[0];
      if (next) this.selectSection(next);
    }
  }

  toggleCollapse(event: Event, section: Section): void {
    event.stopPropagation();
    if (this.collapsedIds.has(section.id)) {
      this.collapsedIds.delete(section.id);
    } else {
      this.collapsedIds.add(section.id);
    }
  }

  isCollapsed(section: Section): boolean {
    return this.collapsedIds.has(section.id);
  }

  startRename(event: Event, section: Section): void {
    event.stopPropagation();
    this.renamingId = section.id;
    this.renameValue = section.name;
    this.cdr.detectChanges();
  }

  finishRename(section: Section): void {
    if (this.renameValue.trim()) {
      section.name = this.renameValue.trim();
    }
    this.renamingId = null;
  }

  cancelRename(): void {
    this.renamingId = null;
  }

  getActiveSectionPath(): string {
    if (!this.activeSection) return '';
    for (const s of this.sections) {
      if (s.id === this.activeSection.id) return s.name;
      for (const c of s.children) {
        if (c.id === this.activeSection.id) return `${s.name} / ${c.name}`;
      }
    }
    return this.activeSection.name;
  }

  getSectionSummary(instructions: string): string {
    if (!instructions) return 'No instructions set';
    const sections = this.markdownToSections(instructions);
    return sections.map(s => s.name).join(', ') || 'No instructions set';
  }

  // --- Editor helpers ---

  private initEditor(markdown: string): void {
    this.destroyEditor();
    const data = this.markdownToEditorData(markdown);
    this.editor = new EditorJS({
      holder: 'editorjs',
      placeholder: 'Write instructions for this section...',
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

  private async saveCurrentSectionContent(): Promise<void> {
    if (!this.activeSection || !this.editor) return;
    try {
      const data = await this.editor.save();
      this.activeSection.content = this.editorDataToMarkdown(data);
    } catch {
      // editor may already be destroyed
    }
  }

  private makeSection(name: string): Section {
    return { id: `s${++this.idCounter}`, name, content: '', children: [] };
  }

  // --- Markdown <-> Sections ---

  private markdownToSections(markdown: string): Section[] {
    if (!markdown || !markdown.trim()) return [];
    const sections: Section[] = [];
    const lines = markdown.split('\n');
    let currentSection: Section | null = null;
    let currentChild: Section | null = null;
    let contentLines: string[] = [];

    const flushContent = () => {
      const content = contentLines.join('\n').trim();
      if (currentChild) {
        currentChild.content = content;
      } else if (currentSection) {
        currentSection.content = content;
      } else if (content) {
        // Content before any heading goes into an Overview section
        const overview = this.makeSection('Overview');
        overview.content = content;
        sections.push(overview);
      }
      contentLines = [];
    };

    for (const line of lines) {
      const h2Match = line.match(/^##\s+(.+)/);
      const h3Match = line.match(/^###\s+(.+)/);

      if (h2Match) {
        flushContent();
        currentChild = null;
        currentSection = this.makeSection(h2Match[1].trim());
        sections.push(currentSection);
      } else if (h3Match && currentSection) {
        flushContent();
        currentChild = this.makeSection(h3Match[1].trim());
        currentSection.children.push(currentChild);
      } else {
        contentLines.push(line);
      }
    }
    flushContent();

    return sections;
  }

  private sectionsToMarkdown(sections: Section[]): string {
    const parts: string[] = [];
    for (const section of sections) {
      parts.push(`## ${section.name}`);
      if (section.content.trim()) {
        parts.push('');
        parts.push(section.content.trim());
      }
      for (const child of section.children) {
        parts.push('');
        parts.push(`### ${child.name}`);
        if (child.content.trim()) {
          parts.push('');
          parts.push(child.content.trim());
        }
      }
      parts.push('');
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- Editor.js data conversion (unchanged) ---

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
    md = md.replace(/<\/?[^>]+(>|$)/g, '');
    md = md.replace(/&nbsp;/g, ' ');
    md = md.replace(/&amp;/g, '&');
    md = md.replace(/&lt;/g, '<');
    md = md.replace(/&gt;/g, '>');
    return md;
  }

  private markdownToEditorData(markdown: string): any {
    if (!markdown || !markdown.trim()) {
      return { time: Date.now(), blocks: [] };
    }

    const blocks: any[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === '') {
        i++;
        continue;
      }

      if (/^---+\s*$/.test(line.trim()) || /^\*\*\*+\s*$/.test(line.trim())) {
        blocks.push({ type: 'delimiter', data: {} });
        i++;
        continue;
      }

      const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headerMatch) {
        blocks.push({
          type: 'header',
          data: { text: this.markdownInlineToHtml(headerMatch[2]), level: headerMatch[1].length },
        });
        i++;
        continue;
      }

      if (line.trim().startsWith('```')) {
        i++;
        const codeLines: string[] = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
        i++;
        continue;
      }

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

      if (/^\s*[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(this.markdownInlineToHtml(lines[i].replace(/^\s*[-*+]\s+/, '')));
          i++;
        }
        blocks.push({ type: 'list', data: { style: 'unordered', items } });
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(this.markdownInlineToHtml(lines[i].replace(/^\s*\d+[.)]\s+/, '')));
          i++;
        }
        blocks.push({ type: 'list', data: { style: 'ordered', items } });
        continue;
      }

      blocks.push({
        type: 'paragraph',
        data: { text: this.markdownInlineToHtml(line) },
      });
      i++;
    }

    return { time: Date.now(), blocks };
  }

  private markdownInlineToHtml(text: string): string {
    if (!text) return '';
    let html = text;
    html = html.replace(/&/g, '&amp;');
    html = html.replace(/</g, '&lt;');
    html = html.replace(/>/g, '&gt;');
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    html = html.replace(/_(.+?)_/g, '<i>$1</i>');
    html = html.replace(/==(.+?)==/g, '<mark class="cdx-marker">$1</mark>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return html;
  }
}
