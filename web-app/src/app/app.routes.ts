import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'chat', loadComponent: () => import('./components/chat/chat.component').then(m => m.ChatComponent) },
  { path: 'chat/:jid', loadComponent: () => import('./components/chat/chat.component').then(m => m.ChatComponent) },
  { path: 'groups', loadComponent: () => import('./components/channels/channels.component').then(m => m.ChannelsComponent) },
  { path: 'groups/register', loadComponent: () => import('./components/group-register/group-register.component').then(m => m.GroupRegisterComponent) },
  { path: 'groups/:jid', loadComponent: () => import('./components/group-detail/group-detail.component').then(m => m.GroupDetailComponent) },
  // New-scheduled-chat hero (creates a chat and attaches a schedule in one step).
  { path: 'tasks/new', loadComponent: () => import('./components/task-create/task-create.component').then(m => m.TaskCreateComponent) },
  { path: 'personalities', loadComponent: () => import('./components/personalities/personalities.component').then(m => m.PersonalitiesComponent) },
  { path: 'credentials', loadComponent: () => import('./components/credentials/credentials.component').then(m => m.CredentialsComponent) },
  // Legacy paths → chats.
  { path: 'tasks', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'tasks/:id', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'dashboard', redirectTo: 'groups', pathMatch: 'full' },
  { path: 'system', redirectTo: 'groups', pathMatch: 'full' },
];
