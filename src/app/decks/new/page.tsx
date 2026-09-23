import { CardSetEditor } from "@/components/cards/card-set-editor";
import { listCoursesWithExams } from "@/lib/queries";

export default async function NewDeckPage(props: PageProps<"/decks/new">) {
  const params = await props.searchParams;
  const courses = await listCoursesWithExams();

  return (
    <CardSetEditor
      courses={courses.map((course) => ({ id: course.id, title: course.title }))}
      defaultCourseId={typeof params.course === "string" ? params.course : undefined}
    />
  );
}
