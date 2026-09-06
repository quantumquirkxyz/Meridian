# GitHub Projects V2 — GraphQL reference

All snippets run through the GitHub CLI. Auth needs the `project` scope for writes
(`gh auth login --scopes "project"`; `read:project` is enough for reads).

All IDs are global node IDs, never REST numeric IDs.

## resolve-owner

Node ID of the owner the board lives under.

```graphql
query {
  organization(login: "quantumquirkxyz") { id }
}
```

For a user account, use `user(login: ...)`. For the authenticated user, use `viewer { id }`. For the current repo's owner, resolve its owner first (`repository(owner:..., name:...) { owner { login } }`), then query by that login.

## list-boards

Boards owned by an org (or `user` for a personal account).

```graphql
query {
  organization(login: "quantumquirkxyz") {
    projectsV2(first: 50) {
      nodes { id title url }
    }
  }
}
```

## create-board

```graphql
mutation {
  createProjectV2(input: {
    ownerId: "OWNER_ID"
    title: "BOARD_TITLE"
  }) {
    projectV2 { id url }
  }
}
```

## update-board

Description and visibility.

```graphql
mutation {
  updateProjectV2(input: {
    projectId: "PROJECT_ID"
    shortDescription: "One-line summary"
    readme: "Longer description"
    public: false
  }) {
    projectV2 { id url }
  }
}
```

## link-repo

`repositoryId` is the repo's global node ID.

```graphql
mutation {
  linkProjectV2ToRepository(input: {
    projectId: "PROJECT_ID"
    repositoryId: "REPO_ID"
  }) {
    repository { id }
  }
}
```

## create-field

Single select:

```graphql
mutation {
  createProjectV2Field(input: {
    projectId: "PROJECT_ID"
    name: "Priority"
    dataType: SINGLE_SELECT
    singleSelectOptions: [
      { name: "High", color: RED }
      { name: "Low", color: GRAY }
    ]
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id
        options { id name }
      }
    }
  }
}
```

Other `dataType` values: `TEXT`, `NUMBER`, `DATE`, `MULTI_SELECT` (uses `multiSelectOptions`), `ITERATION` (uses `iterationConfiguration`). Return the option IDs — the item step needs them.

## create-view

Board layout groups by a field ID; table layout lists fields as columns.

```graphql
mutation {
  createProjectV2View(input: {
    projectId: "PROJECT_ID"
    name: "Board"
    layout: BOARD_LAYOUT
    configuration: { groupByFieldIds: ["STATUS_FIELD_ID"] }
  }) {
    projectV2View { id name layout }
  }
}
```

`layout` values: `BOARD_LAYOUT`, `TABLE_LAYOUT`, `ROADMAP_LAYOUT`.

## add-item

Add an existing issue or PR by its global node ID. Adding an item already on the board returns the existing item — no duplicate.

```graphql
mutation {
  addProjectV2ItemById(input: {
    projectId: "PROJECT_ID"
    contentId: "ISSUE_OR_PR_ID"
  }) {
    item { id }
  }
}
```

## add-draft

```graphql
mutation {
  addProjectV2DraftIssue(input: {
    projectId: "PROJECT_ID"
    title: "Draft title"
    body: "Optional body"
  }) {
    projectItem { id }
  }
}
```

## update-item-field

Run only after the item is added. Value shape depends on the field type: `singleSelectOptionId`, `multiSelectOptionIds`, `text`, `number`, `date`, or `iterationId`.

```graphql
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PROJECT_ID"
    itemId: "ITEM_ID"
    fieldId: "FIELD_ID"
    value: { singleSelectOptionId: "OPTION_ID" }
  }) {
    projectV2Item { id }
  }
}
```

## verify-board

```graphql
query {
  node(id: "PROJECT_ID") {
    ... on ProjectV2 {
      id title url public
      fields(first: 50) {
        nodes { ... on ProjectV2Field { id name } }
      }
      views(first: 50) {
        nodes { id name layout }
      }
      items(first: 100) { totalCount }
    }
  }
}
```
