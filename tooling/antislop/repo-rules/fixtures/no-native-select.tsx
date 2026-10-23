const NativeControl = (): JSX.Element => (
  <select aria-label="Project">
    <option value="project">Project</option>
  </select>
)
const SharedControl = (): JSX.Element => <Combobox label="Project" options={[]} value="" />
