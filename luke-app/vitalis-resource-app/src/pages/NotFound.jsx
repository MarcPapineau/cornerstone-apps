import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <Compass className="h-8 w-8 text-faint" />
      <h1 className="text-lg font-semibold text-foreground">Route not found</h1>
      <p className="max-w-sm text-sm text-faint">This surface has no module at that path.</p>
      <Link to="/"><Button variant="outline" size="sm">Back to Dashboard</Button></Link>
    </div>
  );
}
