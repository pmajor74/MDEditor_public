/**
 * Mermaid Diagram Context
 *
 * Comprehensive rules and examples for generating Mermaid diagrams
 * in Azure DevOps Wiki format.
 */

const MERMAID_CRITICAL_RULES = `
### CRITICAL SYNTAX RULES (MUST FOLLOW)

**⚠️ RULE 0 - ALWAYS QUOTE LABELS WITH SPECIAL CHARACTERS (MOST CRITICAL):**
- ALWAYS use double quotes for labels containing: parentheses (), commas, colons, e.g., etc.
- BAD: \`A[Document Source (e.g., Fax, Scan)]\` - WILL BREAK RENDERING
- GOOD: \`A["Document Source (e.g., Fax, Scan)"]\`
- BAD: \`B[API Gateway: REST]\` - WILL BREAK RENDERING
- GOOD: \`B["API Gateway: REST"]\`
- SAFEST: Quote ALL labels by default: \`C["Simple Label"]\`

**RULE 1 - Proper Node Definition:**
- ALWAYS define nodes with ID and label: \`nodeId["Label Text"]\`
- NEVER use quoted strings directly in arrows
- BAD: \`CMS --> "P2DI System"\` (quoted string as target - WILL FAIL)
- GOOD: \`CMS --> P2DI["P2DI System"]\` (node ID with label)
- BAD: \`A --> B --> C\` (chained arrows - WILL FAIL)
- GOOD: \`A --> B\` then \`B --> C\` on separate lines

**RULE 2 - One Statement Per Line:**
- Put the diagram type on its own line: \`flowchart TD\`
- Put EACH node definition on its own line
- Put EACH arrow connection on its own line
- BAD: \`flowchart TD    A --> B\` (all on one line)
- GOOD:
  \`\`\`
  flowchart TD
      A[First Node]
      B[Second Node]
      A --> B
  \`\`\`

**RULE 3 - Single Line Labels:**
- EVERY label MUST be on ONE LINE - no line breaks inside brackets
- Keep labels SHORT (max 40 chars) - abbreviate long text
- BAD: \`A[This is a very long label
  that spans multiple lines]\`
- GOOD: \`A["Label - Abbreviated"]\`

**RULE 4 - Node IDs:**
- Must be simple: letters, numbers, underscores only
- MUST start with a letter, not a number
- NO spaces: use \`data_processor\` not \`data processor\`
- NO hyphens: use \`api_endpoint\` not \`api-endpoint\`
- NEVER use \`end\` as a node ID — it is a reserved Mermaid keyword (used to close subgraphs). Use \`finish\`, \`done\`, \`stop\`, or \`end_node\` instead
- Other reserved words to avoid as node IDs: \`subgraph\`, \`click\`, \`style\`, \`class\`, \`classDef\`, \`linkStyle\`, \`default\`

**RULE 5 - Quoting Labels (REMINDER):**
- Quote ALL labels to be safe: \`A["My Label"]\`
- MUST quote if label has: parentheses, colons, slashes, commas, or special chars
- Example: \`api["API Gateway (v2)"]\`
- Example: \`doc["Document Source (e.g., Fax, Scan, eLan)"]\`

**RULE 6 - Decision/Diamond Node Syntax:**
- Decision nodes use curly braces: \`nodeId{Label Text}\`
- Do NOT add spaces between \`{\` and the label
- Quotes go directly against the braces with NO space
- NEVER put literal double quotes inside a diamond label — they conflict with mermaid's own quoting
- BAD: \`check{ "Is it valid?" }\` — space before quote breaks rendering
- BAD: \`check{  Is it valid?  }\` — extra spaces break rendering
- BAD: \`check{Does name start with "DV-"?}\` — embedded quotes break rendering
- GOOD: \`check{"Is it valid?"}\`
- GOOD: \`check{Is it valid?}\`
- GOOD: \`check{"Does name start with DV-?"}\` — outer quotes only, no inner quotes
- GOOD: \`check{"Does name start with 'DV-'?"}\` — single quotes inside are safe

**CORRECT Examples:**
\`\`\`mermaid
flowchart TD
    start[Start Process]
    api_call["API Call (REST)"]
    decision{Is Valid?}
    db[(Database)]

    start --> api_call
    api_call --> decision
    decision -->|Yes| db
\`\`\`

**INCORRECT Examples (DO NOT DO THIS):**
\`\`\`
flowchart TD
    1[First]           %% BAD: starts with number
    my-node[Label]     %% BAD: hyphen in ID
    my node[Label]     %% BAD: space in ID
    A[Label (param)]   %% BAD: unquoted special chars
    B --> C --> D      %% BAD: chained arrows (use separate lines)
    end["End"]         %% BAD: 'end' is a reserved keyword - use 'finish' or 'done'
\`\`\`

**Arrow Syntax:**
- Each connection on its own line or separated properly
- Use \`-->|label|\` for labeled arrows, not \`--label-->\`
- For complex flows, define nodes first, then connections

**Subgraphs:**
- Subgraph names with spaces need quotes: \`subgraph "User Layer"\`
- End each subgraph with \`end\`
`;

const MERMAID_CONTEXT = `
## Comprehensive Mermaid Diagram Guide

Mermaid diagrams are supported in Azure DevOps Wiki. Always wrap diagrams in triple backticks with 'mermaid' language tag.

### Flowchart / Graph Diagrams

For process flows, decision trees, and general diagrams:

\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E
\`\`\`

**Direction options:** TD (top-down), TB (top-bottom), BT (bottom-top), LR (left-right), RL (right-left)

**Node shapes:**
- [Text] = Rectangle
- (Text) = Rounded rectangle
- {Text} = Diamond (decision) — e.g., \`nodeId{"Decision?"}\` or \`nodeId{Decision?}\`
- ([Text]) = Stadium shape
- [[Text]] = Subroutine
- [(Text)] = Cylindrical (database)
- ((Text)) = Circle
- >Text] = Asymmetric

**Link styles:**
- --> = Arrow
- --- = Line without arrow
- -.-> = Dotted arrow
- ==> = Thick arrow
- -->|text| = Arrow with label

### Swimlane Diagrams (using subgraphs)

For showing responsibilities across teams/departments:

\`\`\`mermaid
flowchart LR
    subgraph Customer["Customer"]
        A[Submit Request]
    end
    subgraph Support["Support Team"]
        B[Review Request]
        C{Valid?}
    end
    subgraph Engineering["Engineering"]
        D[Implement Fix]
        E[Deploy]
    end

    A --> B
    B --> C
    C -->|Yes| D
    C -->|No| A
    D --> E
\`\`\`

### Sequence Diagrams

For showing interactions between components/actors:

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server
    participant D as Database

    U->>C: Enter credentials
    C->>S: POST /login
    S->>D: Query user
    D-->>S: User data
    S-->>C: JWT token
    C-->>U: Welcome message

    Note over C,S: All communication is encrypted
\`\`\`

**Arrow types:**
- ->> = Solid line with arrowhead
- -->> = Dotted line with arrowhead
- -) = Solid line with open arrow
- --) = Dotted line with open arrow
- -x = Solid line with cross
- --x = Dotted line with cross

**Special features:**
- Note over A,B: text
- Note right of A: text
- activate A / deactivate A
- loop / end
- alt / else / end
- opt / end
- par / and / end

### State Diagrams

For showing state machines:

\`\`\`mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review : Submit
    Review --> Approved : Approve
    Review --> Draft : Request changes
    Approved --> Published : Publish
    Published --> [*]

    state Review {
        [*] --> Pending
        Pending --> InProgress : Assign
        InProgress --> Complete : Finish
    }
\`\`\`

### Class Diagrams

For showing relationships between classes/objects:

\`\`\`mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +bark()
    }
    class Cat {
        +String color
        +meow()
    }

    Animal <|-- Dog
    Animal <|-- Cat
\`\`\`

**Relationship types:**
- <|-- = Inheritance
- *-- = Composition
- o-- = Aggregation
- --> = Association
- -- = Link
- ..> = Dependency
- ..|> = Realization

### Gantt Charts

For project timelines:

\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD

    section Planning
    Requirements   :a1, 2024-01-01, 7d
    Design         :a2, after a1, 14d

    section Development
    Backend        :b1, after a2, 21d
    Frontend       :b2, after a2, 21d

    section Testing
    QA Testing     :c1, after b1, 14d
    UAT            :c2, after c1, 7d
\`\`\`

### Pie Charts

For showing proportions:

\`\`\`mermaid
pie title Distribution
    "Category A" : 45
    "Category B" : 30
    "Category C" : 25
\`\`\`

### Entity Relationship Diagrams

For database schemas:

\`\`\`mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "ordered in"

    CUSTOMER {
        int id PK
        string name
        string email
    }
    ORDER {
        int id PK
        date created
        int customer_id FK
    }
\`\`\`

### Mind Maps

For brainstorming and hierarchical concepts:

\`\`\`mermaid
mindmap
    root((Project))
        Planning
            Requirements
            Timeline
        Development
            Backend
            Frontend
        Testing
            Unit Tests
            Integration
\`\`\`

### Journey Diagrams

For mapping user experiences with satisfaction scores:

\`\`\`mermaid
journey
    title User Onboarding
    section Sign Up
      Visit website: 5: User
      Fill form: 3: User
      Verify email: 4: User, System
    section First Use
      Complete tutorial: 4: User
      Create first project: 5: User
\`\`\`

### Timeline Diagrams

For chronological events and release histories:

\`\`\`mermaid
timeline
    title Release History
    2024-Q1 : v1.0 Launch
             : Core features
    2024-Q2 : v1.1 Update
             : Bug fixes
             : Performance improvements
    2024-Q3 : v2.0 Major Release
             : New UI
\`\`\`

### Git Graph Diagrams

For visualizing branching and merge strategies:

\`\`\`mermaid
gitGraph
    commit
    branch develop
    commit
    commit
    checkout main
    merge develop
    commit
    branch release
    commit
    checkout main
    merge release tag: "v1.0"
\`\`\`

### C4 Context Diagrams

For high-level system architecture:

\`\`\`mermaid
C4Context
    title System Context
    Person(user, "Developer", "Uses the wiki editor")
    System(editor, "Wiki Editor", "Desktop Electron app")
    System_Ext(devops, "Azure DevOps", "Wiki hosting")

    Rel(user, editor, "Edits articles")
    Rel(editor, devops, "Syncs content", "REST API")
\`\`\`

### Quadrant Charts

For priority matrices and two-axis comparisons:

\`\`\`mermaid
quadrantChart
    title Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Do First
    quadrant-2 Plan
    quadrant-3 Delegate
    quadrant-4 Eliminate
    Feature A: [0.2, 0.8]
    Feature B: [0.7, 0.9]
    Feature C: [0.8, 0.3]
\`\`\`

### Sankey Diagrams

For showing flow quantities between nodes:

\`\`\`mermaid
sankey-beta
    Source A,Target X,50
    Source A,Target Y,30
    Source B,Target X,20
    Source B,Target Y,40
\`\`\`

### XY Charts

For bar and line charts with labeled axes:

\`\`\`mermaid
xychart-beta
    title "Build Times"
    x-axis [Mon, Tue, Wed, Thu, Fri]
    y-axis "Minutes" 0 --> 30
    bar [12, 18, 15, 22, 10]
    line [14, 16, 14, 20, 12]
\`\`\`

### Block Diagrams

For system block layouts with directional arrows:

\`\`\`mermaid
block-beta
    columns 3
    Frontend blockArrowId<["  "]>(right) Backend
    space:3
    db[("Database")]
    Backend --> db
\`\`\`

### Best Practices

1. **Keep diagrams focused** - One concept per diagram
2. **Use meaningful labels** - Avoid single letters unless obvious
3. **Consistent direction** - Choose TD or LR and stick with it
4. **Add notes/comments** - Use Note blocks to explain complex parts
5. **Test rendering** - Some complex diagrams may need simplification
6. **Use subgraphs** - Group related nodes for swimlanes/containers

### Common Issues

1. **Special characters** - Escape or avoid special chars in labels
2. **Long labels** - Keep text concise; use abbreviations if needed
3. **Complex layouts** - Break into multiple simpler diagrams
4. **Browser compatibility** - Some features may render differently

${MERMAID_CRITICAL_RULES}

**For Complex System Diagrams:**
1. Use short, clear node IDs: \`cms\`, \`api\`, \`db\`, \`queue\`
2. Define all nodes with shapes first
3. Then define all connections
4. Group related nodes in subgraphs
5. Use comments (%% comment) to organize sections

**Example Complex Diagram:**
\`\`\`mermaid
flowchart LR
    %% Define nodes
    client[Client App]
    api["API Gateway"]
    auth{Authenticated?}
    svc1["Service 1"]
    svc2["Service 2"]
    db[(Database)]
    queue[/Message Queue/]

    %% Define connections
    client --> api
    api --> auth
    auth -->|Yes| svc1
    auth -->|No| client
    svc1 --> db
    svc1 --> queue
    queue --> svc2
\`\`\`

**Example Azure DevOps Pipeline:**
\`\`\`mermaid
flowchart LR
    subgraph Source["Source Control"]
        repo["Azure Repos"]
    end
    subgraph Build["Build Pipeline"]
        trigger["PR Trigger"]
        build["Build + Test"]
        scan["Security Scan"]
    end
    subgraph Deploy["Release Pipeline"]
        dev["Dev"]
        staging["Staging"]
        prod["Production"]
    end

    repo --> trigger
    trigger --> build
    build --> scan
    scan --> dev
    dev --> staging
    staging --> prod
\`\`\`
`;

module.exports = { MERMAID_CONTEXT, MERMAID_CRITICAL_RULES };
