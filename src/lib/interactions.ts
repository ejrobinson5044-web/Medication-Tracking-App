import type { Medication } from './types';

interface InteractionRule {
  groupA: string[];
  groupB: string[];
  reason: string;
}

// Curated, non-exhaustive list of well-known contraindicated combinations.
// This is a convenience flag, not medical advice — always confirm with a
// pharmacist or prescriber.
const RULES: InteractionRule[] = [
  {
    groupA: ['warfarin', 'coumadin'],
    groupB: ['aspirin', 'ibuprofen', 'naproxen', 'advil', 'aleve', 'motrin'],
    reason: 'Increased risk of bleeding',
  },
  {
    groupA: ['warfarin', 'coumadin'],
    groupB: ['amiodarone', 'pacerone'],
    reason: 'Amiodarone can dangerously increase warfarin levels',
  },
  {
    groupA: ['lisinopril', 'enalapril', 'ramipril', 'losartan', 'valsartan'],
    groupB: ['spironolactone', 'potassium chloride', 'potassium', 'aldactone'],
    reason: 'Risk of dangerously high potassium (hyperkalemia)',
  },
  {
    groupA: ['sildenafil', 'viagra', 'tadalafil', 'cialis', 'vardenafil'],
    groupB: ['nitroglycerin', 'isosorbide', 'nitrate'],
    reason: 'Can cause a severe, life-threatening drop in blood pressure',
  },
  {
    groupA: ['sertraline', 'zoloft', 'fluoxetine', 'prozac', 'paroxetine', 'citalopram', 'escitalopram'],
    groupB: ['tramadol', 'phenelzine', 'tranylcypromine', 'selegiline', 'maoi'],
    reason: 'Risk of serotonin syndrome',
  },
  {
    groupA: ['simvastatin', 'lovastatin'],
    groupB: ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'],
    reason: 'Increased risk of muscle damage (rhabdomyolysis)',
  },
  {
    groupA: ['metformin'],
    groupB: ['contrast dye', 'iodinated contrast'],
    reason: 'Increased risk of lactic acidosis',
  },
  {
    groupA: ['digoxin', 'lanoxin'],
    groupB: ['amiodarone', 'pacerone'],
    reason: 'Amiodarone can raise digoxin to toxic levels',
  },
  {
    groupA: ['methotrexate'],
    groupB: ['ibuprofen', 'naproxen', 'aspirin', 'advil', 'aleve', 'motrin'],
    reason: 'NSAIDs can raise methotrexate to toxic levels',
  },
];

function matches(med: Medication, keywords: string[]): boolean {
  const haystack = `${med.name} ${med.brandOrCommonName ?? ''}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

export interface InteractionWarning {
  medA: Medication;
  medB: Medication;
  reason: string;
}

export function checkInteractions(meds: Medication[]): InteractionWarning[] {
  const warnings: InteractionWarning[] = [];

  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      const a = meds[i];
      const b = meds[j];
      for (const rule of RULES) {
        const aMatchesA = matches(a, rule.groupA);
        const bMatchesB = matches(b, rule.groupB);
        const aMatchesB = matches(a, rule.groupB);
        const bMatchesA = matches(b, rule.groupA);
        if ((aMatchesA && bMatchesB) || (aMatchesB && bMatchesA)) {
          warnings.push({ medA: a, medB: b, reason: rule.reason });
        }
      }
    }
  }

  return warnings;
}
