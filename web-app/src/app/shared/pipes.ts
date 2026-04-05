import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'groupNames', standalone: true })
export class GroupNamesPipe implements PipeTransform {
  transform(groups: { name: string }[] | null): string {
    if (!groups?.length) return '-';
    return groups.map(g => g.name).join(', ');
  }
}
