import { UtensilsCrossed } from 'lucide-react';
import { ReservedModule } from '../components/ReservedModule.jsx';

export default function Diet() {
  return (
    <ReservedModule
      title="Diet / Meal-Prep"
      description="Weekly and monthly meal planning on the shared core, allergen-aware when a lab panel is provided. Reserved — defined ahead of wiring."
      icon={UtensilsCrossed}
      summary="Generates meal plans and grocery lists from diet inputs. Built native (no AGPL / Commons-Clause forks) so it stays white-label safe."
      capabilities={[
        'Weekly or monthly meal-plan generation from diet inputs',
        'Allergen-aware planning when a lab panel is provided',
        'Grocery list + ingredient substitutions per plan',
        'Native build — avoids share-alike / hosted-selling-restricted OSS planners',
      ]}
      models={['MealPlan', 'Recipe', 'GroceryList', 'Substitution']}
    />
  );
}
