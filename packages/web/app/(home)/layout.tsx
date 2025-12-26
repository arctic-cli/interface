import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/'>) {
  return <main className="flex min-h-screen flex-col">{children}</main>;
}
