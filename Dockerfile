  FROM node:current-alpine

  # Create and change to the app directory
  WORKDIR /usr/src/app

  # Copy package.json and package-lock.json
  COPY package*.json ./

  # Install dependencies
  RUN npm install

  # Copy the rest of the application code
  COPY . .

  # Expose the port the app runs on
  EXPOSE 3000

  RUN npm install ecovacs-deebot --no-optional

  # Command to run the app
  CMD ["sh", "-c", "node spot-area-cleaning.js && sleep 30 && exit 0"]
