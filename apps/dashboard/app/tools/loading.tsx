import { Container, Hero, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <Hero>
        <Skeleton dark className="h-4 w-32" />
        <Skeleton dark className="mt-4 h-12 w-[36rem]" />
        <Skeleton dark className="mt-4 h-5 w-[32rem]" />
      </Hero>
      <Container className="py-10">
        <Skeleton className="h-36" />
        <div className="mt-8 grid grid-cols-3 gap-6">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[32rem]" />)}
        </div>
      </Container>
    </div>
  );
}
