# cms-architecture

Design content management systems — content models, editorial workflows, publishing pipelines, localization — with schema evolution and multi-channel delivery.

## Goals
- Define content models that are reusable across channels
- Plan editorial workflows with roles and approval states
- Design multi-language and multi-site architecture
- Ensure content portability and schema versioning

## Contract

### Input
A content platform to design: content types, publishing channels, team structure.

### Output
A CMS architecture with:
- Content model (entities, relationships, metadata)
- Editorial workflow (states, roles, transitions)
- Localization strategy
- API design for content delivery

## Content Model Patterns

| Pattern | Use case | Example |
|---|---|---|
| Page | Static, hierarchical | Marketing sites |
| Article | Time-based, rich media | Blogs, news |
| Product | Structured, transactional | E-commerce |
| Component | Reusable, composable | Design systems |
| Taxononomy | Classification | Categories, tags |

## Steps

1. **Audit content** — existing content types, volume, reuse patterns
2. **Define content model** — entities, fields, relationships
3. **Design workflow** — draft → review → approved → published
4. **Plan localization** — language variants, fallback, RTL
5. **Choose CMS architecture** — headless (API), coupled, hybrid
6. **Design delivery API** — query, filter, personalize
7. **Plan migration** — content mapping, transformation scripts

## References
- `../backend/backend-architecture/SKILL.md` — API design
- `../../frontend/frontend-design/SKILL.md` — content rendering
- `../../data/data-etl-pipeline/SKILL.md` — content migration
