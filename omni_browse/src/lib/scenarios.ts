import { Scenario } from './types';

export const SCENARIOS: Scenario[] = [
  {
    id: 'complex-insurance',
    title: 'Complex Life & Health Insurance Co-Browsing',
    category: 'Fintech & Insurtech',
    targetUrl: 'https://starshield-insurance.com/apply/term-plus-riders',
    description: 'Multi-tiered policy application where users get stuck on complex rider add-ons, underwriting clauses, and premium trade-offs. Co-browse agent pops up, establishes WebRTC/WebSocket, and assists live.',
    badge: 'Flagship Co-Browse Use Case',
    initialState: {
      applicantAge: 32,
      annualIncome: '₹15L - ₹20L',
      isSmoker: false,
      basePlan: '₹1 Crore Pure Life Cover',
      basePremium: 850,
      riderCriticalIllness: false,
      riderAccidentalDeath: false,
      riderWaiverPremium: false,
      riderHospitalCash: false,
      totalPremium: 850,
      medicalDeclarationAccepted: false,
      wsConnected: false,
      webrtcActive: false,
      applicationSubmitted: false,
      policyNumber: null,
    },
    samplePrompts: [
      'My family has a history of cardiac issues. Which rider should I choose, and what is my total premium?',
      'Explain the Critical Illness vs Accidental Death rider and add the recommended one to my plan',
      'Help me choose the optimal riders for a 32-year-old non-smoker and submit the application'
    ],
    elements: [
      {
        id: 'applicant-age',
        tag: 'input',
        label: 'Applicant Age (Years)',
        value: '32',
        samMask: { x: 6, y: 14, width: 26, height: 7, confidence: 0.99, category: 'form_input' }
      },
      {
        id: 'annual-income',
        tag: 'select',
        label: 'Annual Income Slab',
        options: ['₹5L - ₹10L', '₹10L - ₹15L', '₹15L - ₹20L', '₹20L+'],
        samMask: { x: 35, y: 14, width: 28, height: 7, confidence: 0.97, category: 'selection_dropdown' }
      },
      {
        id: 'smoker-status',
        tag: 'input',
        type: 'checkbox',
        label: 'Non-Smoker (Avails 20% healthy lifestyle discount)',
        samMask: { x: 66, y: 14, width: 28, height: 7, confidence: 0.96, category: 'interactive_button' }
      },
      {
        id: 'base-cover-select',
        tag: 'select',
        label: 'Base Life Protection Cover',
        options: ['₹50 Lakhs (₹550/mo)', '₹1 Crore Pure Life Cover (₹850/mo)', '₹2 Crores Maximum Shield (₹1,450/mo)'],
        samMask: { x: 6, y: 24, width: 88, height: 8, confidence: 0.98, category: 'selection_dropdown' }
      },
      {
        id: 'rider-card-ci',
        tag: 'div',
        label: 'Critical Illness Rider: Covers 36 illnesses (Heart, Cancer, Stroke) with ₹25L lump-sum payout (+₹160/mo)',
        samMask: { x: 6, y: 35, width: 42, height: 16, confidence: 0.98, category: 'action_card' }
      },
      {
        id: 'rider-card-ad',
        tag: 'div',
        label: 'Accidental Death & Total Disability Rider: Double payout on transit accidents (+₹85/mo)',
        samMask: { x: 52, y: 35, width: 42, height: 16, confidence: 0.97, category: 'action_card' }
      },
      {
        id: 'rider-card-wp',
        tag: 'div',
        label: 'Waiver of Premium Rider: All future premiums waived if diagnosed with permanent disability (+₹45/mo)',
        samMask: { x: 6, y: 54, width: 42, height: 14, confidence: 0.96, category: 'action_card' }
      },
      {
        id: 'rider-card-hc',
        tag: 'div',
        label: 'Daily Hospital Cash Rider: ₹5,000/day allowance during any hospitalization (+₹60/mo)',
        samMask: { x: 52, y: 54, width: 42, height: 14, confidence: 0.95, category: 'action_card' }
      },
      {
        id: 'medical-declaration-box',
        tag: 'input',
        type: 'checkbox',
        label: 'I confirm accurate medical declarations as per Section 45 of Insurance Act',
        samMask: { x: 6, y: 70, width: 88, height: 6, confidence: 0.94, category: 'interactive_button' }
      },
      {
        id: 'btn-submit-insurance',
        tag: 'button',
        label: 'Submit Application & Lock Guaranteed Premium',
        samMask: { x: 6, y: 79, width: 46, height: 8, confidence: 0.99, category: 'interactive_button' }
      }
    ]
  },
  {
    id: 'irctc-transit',
    title: 'Indian Railways (IRCTC) Booking',
    category: 'Public Transport & Transit',
    targetUrl: 'https://irctc.gov.in/eticketing/booking',
    description: 'Complex multi-step railway booking with stations, dates, quota, and concession checkboxes.',
    badge: 'Popular Bharat Use Case',
    initialState: {
      fromStation: '',
      toStation: '',
      journeyDate: '2026-10-28',
      travelClass: 'AC 3 Tier (3A)',
      quota: 'GENERAL',
      seniorCitizen: false,
      trainSelected: null,
      bookingConfirmed: false,
    },
    samplePrompts: [
      'Book 1 ticket from New Delhi to Mumbai for Oct 28 in 3A with Senior Citizen discount',
      'Find fastest morning train from NDLS to MMCT',
      'Check availability in AC 3 Tier for tomorrow'
    ],
    elements: [
      {
        id: 'from-station',
        tag: 'input',
        label: 'Origin Station',
        placeholder: 'e.g. NDLS - New Delhi',
        samMask: { x: 8, y: 16, width: 40, height: 8, confidence: 0.98, category: 'form_input' }
      },
      {
        id: 'to-station',
        tag: 'input',
        label: 'Destination Station',
        placeholder: 'e.g. MMCT - Mumbai Central',
        samMask: { x: 52, y: 16, width: 40, height: 8, confidence: 0.97, category: 'form_input' }
      },
      {
        id: 'journey-date',
        tag: 'input',
        type: 'date',
        label: 'Journey Date',
        samMask: { x: 8, y: 28, width: 28, height: 8, confidence: 0.96, category: 'form_input' }
      },
      {
        id: 'travel-class',
        tag: 'select',
        label: 'Travel Class',
        options: ['All Classes', 'AC 3 Tier (3A)', 'AC 2 Tier (2A)', 'Sleeper (SL)'],
        samMask: { x: 38, y: 28, width: 28, height: 8, confidence: 0.94, category: 'selection_dropdown' }
      },
      {
        id: 'quota-select',
        tag: 'select',
        label: 'Quota',
        options: ['GENERAL', 'TATKAL', 'LADIES', 'SENIOR CITIZEN'],
        samMask: { x: 68, y: 28, width: 24, height: 8, confidence: 0.95, category: 'selection_dropdown' }
      },
      {
        id: 'senior-citizen-toggle',
        tag: 'input',
        type: 'checkbox',
        label: 'Avail Senior Citizen Concession (60+ yrs)',
        samMask: { x: 8, y: 39, width: 50, height: 5, confidence: 0.92, category: 'interactive_button' }
      },
      {
        id: 'btn-search-trains',
        tag: 'button',
        label: 'Search Available Trains',
        samMask: { x: 8, y: 47, width: 36, height: 8, confidence: 0.99, category: 'interactive_button' }
      },
      {
        id: 'card-rajdhani',
        tag: 'div',
        label: '12952 TEJAS RAJDHANI (Dep: 16:55 NDLS -> Arr: 08:35 MMCT)',
        samMask: { x: 8, y: 60, width: 84, height: 18, confidence: 0.95, category: 'action_card' }
      },
      {
        id: 'btn-book-now',
        tag: 'button',
        label: 'Book Ticket (₹2,140)',
        samMask: { x: 65, y: 65, width: 24, height: 8, confidence: 0.98, category: 'interactive_button' }
      }
    ]
  },
  {
    id: 'ayushman-bharat',
    title: 'Senior Citizen Health Card (Ayushman)',
    category: 'Government & Social Welfare',
    targetUrl: 'https://beneficiary.nha.gov.in/senior-registration',
    description: 'National health protection scheme enrollment for individuals aged 60+.',
    badge: 'High Impact Social AI',
    initialState: {
      applicantName: '',
      aadhaarNumber: '',
      state: 'Maharashtra',
      district: 'Pune',
      benefitTier: 'Universal Tier 1 (₹5,00,000 cover)',
      registered: false,
    },
    samplePrompts: [
      'Register Ramesh Thorat for Senior Ayushman Card with Aadhaar 4590-1234-8976 in Pune',
      'Apply for free senior citizen health insurance benefit',
      'Check eligibility and fill the application form'
    ],
    elements: [
      {
        id: 'applicant-name',
        tag: 'input',
        label: 'Full Name (as per Aadhaar)',
        placeholder: 'e.g. Ramesh Shankar Thorat',
        samMask: { x: 8, y: 16, width: 84, height: 8, confidence: 0.98, category: 'form_input' }
      },
      {
        id: 'aadhaar-number',
        tag: 'input',
        label: '12-Digit Aadhaar Identification',
        placeholder: 'XXXX - XXXX - XXXX',
        samMask: { x: 8, y: 28, width: 42, height: 8, confidence: 0.99, category: 'form_input' }
      },
      {
        id: 'state-select',
        tag: 'select',
        label: 'State',
        options: ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Gujarat'],
        samMask: { x: 52, y: 28, width: 40, height: 8, confidence: 0.95, category: 'selection_dropdown' }
      },
      {
        id: 'district-select',
        tag: 'select',
        label: 'District',
        options: ['Pune', 'Mumbai City', 'Thane', 'Nagpur', 'Nashik'],
        samMask: { x: 8, y: 40, width: 42, height: 8, confidence: 0.94, category: 'selection_dropdown' }
      },
      {
        id: 'consent-box',
        tag: 'input',
        type: 'checkbox',
        label: 'I voluntarily provide biometric & demographic consent for verification',
        samMask: { x: 8, y: 52, width: 84, height: 6, confidence: 0.91, category: 'interactive_button' }
      },
      {
        id: 'btn-submit-ayushman',
        tag: 'button',
        label: 'Generate Digital Health Card',
        samMask: { x: 8, y: 62, width: 44, height: 9, confidence: 0.99, category: 'interactive_button' }
      }
    ]
  }
];
