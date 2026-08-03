.PHONY: build test dev clean deploy-local

build:
	npx hardhat compile
	npm run build:app

test:
	npx hardhat test

dev:
	npm run dev

clean:
	npx hardhat clean
	rm -rf cache artifacts typechain-types out .next

deploy-local:
	npx hardhat run scripts/deploy.ts --network localhost
