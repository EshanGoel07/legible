import { Container, Hero, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div>
      <Hero>
        <div className="grid grid-cols-2 gap-12">
          <div>
            <Skeleton dark className="h-4 w-48" />
            <Skeleton dark className="mt-4 h-12 w-[28rem]" />
            <Skeleton dark className="mt-4 h-5 w-[30rem]" />
          </div>
          <Skeleton dark className="h-56" />
        </div>
      </Hero>
      <Container className="space-y-4 py-10">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}
      </Container>
    </div>
  );
}
