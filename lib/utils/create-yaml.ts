import * as fs from 'fs/promises';
import * as path from 'path';
import { prettier } from './formatting';

export async function createYaml(libraryPath: string) {
  await fs.mkdir(libraryPath, { recursive: true });

  const yamlContent = `
data:                           # Application-specific data definitions
  routes:                       # List of API routes
    - url: /auth/login         # Endpoint for user login
      method: POST              # HTTP method for the endpoint
    - url: /posts               # Endpoint for retrieving blog posts
      method: GET               # HTTP method for the endpoint
    - url: /posts/:id           # Endpoint for retrieving a specific post by ID
      method: GET               # HTTP method for the endpoint

tables:                         # Definitions for database tables
  # Table 1 - Authors
  authors:
    columns:
      - name: id                # Primary key column
        type: pk                 # Indicates this is a primary key
      - name: name               # Author's name
        type: varchar             # String data type
        length: 255               # Maximum length of 255 characters
        isNullable: false         # Indicates this column cannot be null
      - name: email              # Author's email
        type: varchar             # String data type
        length: 255               # Maximum length of 255 characters
        isNullable: false         # Indicates this column cannot be null
    ifNotExists: true            # Create this table only if it does not exist

  # Table 2 - Categories
  categories:
    columns:
      - name: id                # Primary key column
        type: pk                 # Indicates this is a primary key
      - name: name               # Category name
        type: varchar             # String data type
        length: 100               # Maximum length of 100 characters
        isNullable: false         # Indicates this column cannot be null
      - name: description        # Description of the category
        type: varchar             # String data type
        length: 512               # Maximum length of 512 characters
        isNullable: true          # This column can be null
    ifNotExists: true            # Create this table only if it does not exist

  # Table 3 - Posts
  posts:
    columns:
      - name: id                # Primary key column
        type: pk                 # Indicates this is a primary key
      - name: title              # Title of the post
        type: varchar             # String data type
        length: 255               # Maximum length of 255 characters
        isNullable: false         # Indicates this column cannot be null
      - name: content            # Content of the post
        type: text                # Text data type for large content
        isNullable: false         # Indicates this column cannot be null
      - name: author_id          # Foreign key referencing the author
        type: fk                  # Foreign key type
        references:
          table: authors          # References the 'authors' table
          column: id              # References the 'id' column in 'authors'
          onDelete: CASCADE       # Deletes posts if the related author is deleted
      - name: category_id        # Foreign key referencing the category
        type: fk                  # Foreign key type
        references:
          table: categories       # References the 'categories' table
          column: id              # References the 'id' column in 'categories'
          onDelete: RESTRICT      # Prevents deletion of categories if posts are associated
      - name: created_at         # Timestamp for when the post was created
        type: timestamp           # Timestamp data type
        isNullable: false         # Indicates this column cannot be null
      - name: updated_at         # Timestamp for when the post was last updated
        type: timestamp           # Timestamp data type
        isNullable: true          # This column can be null
    ifNotExists: true            # Create this table only if it does not exist

  `.trim();

  const yamlFilePath = path.join(libraryPath, `hedhog.yaml`);
  await fs.writeFile(yamlFilePath, yamlContent);
  await prettier(yamlFilePath);
}
