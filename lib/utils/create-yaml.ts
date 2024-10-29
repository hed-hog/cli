import * as fs from 'fs/promises';
import * as path from 'path';
import { prettier } from './formatting';

export async function createYaml(libraryPath: string) {
  await fs.mkdir(libraryPath, { recursive: true });

  const yamlContent = `
data: # Application-specific data definitions
  routes: # List of API routes
    - url: /auth/login # Endpoint for user login
      method: POST # HTTP method for the endpoint
    - url: /posts # Endpoint for retrieving blog posts
      method: GET # HTTP method for the endpoint
    - url: /posts/:id # Endpoint for retrieving a specific post by ID
      method: GET # HTTP method for the endpoint

tables: # Definitions for database tables
  # Table 1 - Authors
  authors:
    columns:
      - type: pk # Type PK creates a primary key called id
      - name: name # Column's default values are: type varchar, length 255 and not null
      - name: email # Author's email
    ifNotExists: true # Create this table only if it does not exist

  # Table 2 - Categories
  categories:
    columns:
      - type: pk # Indicates this is a primary key
      - type: slug
      - name: created_at
      - name: updated_at
    ifNotExists: true # Create this table only if it does not exist

  category_translations:
    columns:
    - name: category_id
      type: fk
      isPrimary: true
      references:
          table: categories
          column: id
          onDelete: RESTRICT
    - name: locale_id
      type: fk
      isPrimary: true
      references:
          table: locales
          column: id
          onDelete: RESTRICT
    - name: name 
      length: 100
    - name: description
      length: 512
    - name: created_at
    - name: updated_at

  # Table 3 - Posts
  posts:
    columns:
      - type: pk # Indicates this is a primary key
      - name: title # Title of the post
      - name: content # Content of the post
        type: text # Text data type for large content
      - name: author_id # Foreign key referencing the author
        type: fk # Foreign key type
        references:
          table: authors # References the 'authors' table
          column: id # References the 'id' column in 'authors'
          onDelete: CASCADE # Deletes posts if the related author is deleted
      - name: category_id # Foreign key referencing the category
        type: fk # Foreign key type
        references:
          table: categories # References the 'categories' table
          column: id # References the 'id' column in 'categories'
          onDelete: RESTRICT # Prevents deletion of categories if posts are associated
      - name: created_at # Timestamp for when the post was created
      - name: updated_at # Timestamp for when the post was last updated
    ifNotExists: true # Create this table only if it does not exist


  `.trim();

  const yamlFilePath = path.join(libraryPath, `hedhog.yaml`);
  await fs.writeFile(yamlFilePath, yamlContent);
  await prettier(yamlFilePath);
}
