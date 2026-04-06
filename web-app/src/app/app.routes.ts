import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'dashboard', loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'chat', loadComponent: () => import('./components/chat/chat.component').then(m => m.ChatComponent) },
  { path: 'groups', loadComponent: () => import('./components/groups/groups.component').then(m => m.GroupsComponent) },
  { path: 'groups/register', loadComponent: () => import('./components/group-register/group-register.component').then(m => m.GroupRegisterComponent) },
  { path: 'groups/:jid', loadComponent: () => import('./components/group-detail/group-detail.component').then(m => m.GroupDetailComponent) },
  { path: 'tasks', loadComponent: () => import('./components/tasks/tasks.component').then(m => m.TasksComponent) },
  { path: 'tasks/new', loadComponent: () => import('./components/task-create/task-create.component').then(m => m.TaskCreateComponent) },
  { path: 'tasks/:id', loadComponent: () => import('./components/task-detail/task-detail.component').then(m => m.TaskDetailComponent) },
  { path: 'personalities', loadComponent: () => import('./components/personalities/personalities.component').then(m => m.PersonalitiesComponent) },
  { path: 'credentials', loadComponent: () => import('./components/credentials/credentials.component').then(m => m.CredentialsComponent) },
  { path: 'system', loadComponent: () => import('./components/system/system.component').then(m => m.SystemComponent) },
];
